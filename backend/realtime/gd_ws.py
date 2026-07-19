"""Realtime WebSocket hub for GD Live sessions.

Manages per-session connections, holds transient room state (speaker, round,
ready/hand status, mute) and broadcasts events to every connected participant
so the discussion workspace stays in sync without polling.

Phase 3 additions:
- Team-isolated broadcasting (broadcast_to_team)
- Audio chunk relay for Whisper transcription
- Live AI analysis streaming
- Speaker flow management (early finish, auto-switch)
- Room completion and AI evaluation trigger
"""

from __future__ import annotations

import asyncio
import logging
import json
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import _return, get_connection, get_db
from backend.ai.evaluation import evaluate_transcript
from backend.security import decode_token

logger = logging.getLogger("speaksense.realtime")

router = APIRouter(prefix="/ws/gd-live", tags=["GD Live Realtime"])


def _auth_user(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except Exception:
        return None
    connection = get_connection()
    try:
        return queries.get_user_by_id(connection, user_id)
    finally:
        _return(connection)


def _participant_snapshot(connection: MySQLConnection, session_code: str) -> list[dict]:
    return queries.get_live_participants(connection, session_code)


def _fetch_participants(session_code: str) -> list[dict]:
    conn = get_connection()
    try:
        return queries.get_live_participants(conn, session_code)
    finally:
        _return(conn)


async def broadcast_participants(session_code: str) -> None:
    try:
        participants = await asyncio.to_thread(_fetch_participants, session_code)
    except Exception as exc:
        logger.warning("broadcast_participants failed: %s", exc)
        return
    await manager.broadcast(session_code, "PARTICIPANTS_UPDATED", {"participants": participants})


def _save_evaluation_db(session_code: str, user_id: int, team_number: int, transcript: str) -> None:
    """Run AI evaluation and persist to DB. Called in a thread to avoid blocking the event loop."""
    connection = get_connection()
    try:
        participant = queries.fetch_one(connection,
            "SELECT id, team_number FROM gd_live_participants WHERE session_code = %s AND user_id = %s",
            (session_code, user_id))
        if not participant:
            logger.warning("_save_evaluation_db: participant not found uid=%s code=%s", user_id, session_code)
            return
        result = evaluate_transcript(transcript)
        relevance_score = min(100, result.grammar_score * 0.3 + result.fluency_score * 0.3 + result.confidence_score * 0.4)
        content_quality = min(100, result.vocabulary_score * 0.5 + result.overall_score * 0.5)
        accent_score = result.pronunciation_score
        overall = round((result.grammar_score + result.fluency_score + accent_score + relevance_score + content_quality) / 5, 2)
        points = round(overall * 0.5, 2)
        weaknesses = []
        tips = []
        if result.grammar_score < 70:
            weaknesses.append("Grammar needs improvement")
            tips.append("Practice sentence construction and verb tenses")
        if result.fluency_score < 70:
            weaknesses.append("Fluency needs improvement")
            tips.append("Speak slowly and use filler words naturally")
        if result.pronunciation_score < 70:
            weaknesses.append("Pronunciation needs improvement")
            tips.append("Practice difficult words and tongue twisters")
        if result.confidence_score < 70:
            weaknesses.append("Confidence needs improvement")
            tips.append("Maintain steady pace and practice eye contact")
        if result.vocabulary_score < 70:
            weaknesses.append("Vocabulary needs improvement")
            tips.append("Read widely and learn new words daily")
        if not weaknesses:
            weaknesses.append("Great overall performance!")
            tips.append("Keep up the good work and challenge yourself with harder topics")
        queries.save_live_evaluation(
            connection, session_code, user_id, team_number, transcript,
            overall, result.fluency_score, result.grammar_score,
            accent_score, relevance_score, content_quality, points,
            "; ".join(weaknesses), "; ".join(tips),
        )
        logger.info("Evaluation saved uid=%s code=%s team=%s score=%s", user_id, session_code, team_number, overall)
    except Exception as exc:
        logger.warning("_save_evaluation_db failed: %s", exc)
    finally:
        _return(connection)


class TeamState:
    """Per-team state for parallel discussion: timer, members, evaluation."""

    def __init__(self, team_number: int, topic: str, members: list[dict]) -> None:
        self.team_number = team_number
        self.topic = topic
        self.members: dict[int, dict] = {m["user_id"]: m for m in members}
        self.finished_user_ids: set[int] = set()
        self.all_finished = False
        self.timer_seconds = 600  # 10 minutes shared discussion timer
        self.timer_running = False
        self.transcripts: dict[int, str] = {}
        self.evaluations: dict[int, dict] = {}

    def snapshot(self) -> dict:
        return {
            "team_number": self.team_number,
            "topic": self.topic,
            "finished_user_ids": list(self.finished_user_ids),
            "all_finished": self.all_finished,
            "timer_seconds": self.timer_seconds,
            "timer_running": self.timer_running,
            "members": [
                {
                    "user_id": uid,
                    "name": m.get("name"),
                    "label": m.get("label"),
                    "status": "finished" if uid in self.finished_user_ids else "recording",
                }
                for uid, m in self.members.items()
            ],
        }


class RoomState:
    """Transient, in-memory state for one live session room."""

    def __init__(self, session_code: str, topic: str | None = None) -> None:
        self.session_code = session_code
        self.topic = topic
        self.paused = False
        self.ended = False
        self.participants: dict[int, dict] = {}
        self.team_states: dict[int, TeamState] = {}

    def ensure_team(self, team_number: int, topic: str, members: list[dict]) -> TeamState:
        if team_number not in self.team_states:
            self.team_states[team_number] = TeamState(team_number, topic, members)
        return self.team_states[team_number]

    def snapshot(self) -> dict:
        return {
            "topic": self.topic,
            "paused": self.paused,
            "ended": self.ended,
            "participants": [
                {
                    "user_id": uid,
                    "name": p.get("name"),
                    "label": p.get("label"),
                    "team_number": p.get("team_number"),
                    "status": p.get("status"),
                }
                for uid, p in self.participants.items()
            ],
            "teams": {tn: ts.snapshot() for tn, ts in self.team_states.items()},
        }


class ClientInfo:
    """Metadata attached to each connected WebSocket."""
    def __init__(self, ws: WebSocket, user_id: int, role: str, name: str | None, team_number: int | None = None):
        self.ws = ws
        self.user_id = user_id
        self.role = role
        self.name = name
        self.team_number = team_number


class GDLiveConnectionManager:
    """Holds active WebSocket connections keyed by session_code."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[int, ClientInfo]] = {}
        self._state: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_code: str, ws: WebSocket, user_id: int, role: str, name: str | None, team_number: int | None = None) -> None:
        async with self._lock:
            room = self._rooms.setdefault(session_code, {})
            room[id(ws)] = ClientInfo(ws, user_id, role, name, team_number)

    async def disconnect(self, session_code: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(session_code)
            if room:
                room.pop(id(ws), None)
                if not room:
                    self._rooms.pop(session_code, None)

    def get_user_team(self, session_code: str, user_id: int) -> int | None:
        room = self._rooms.get(session_code)
        if not room:
            return None
        for ci in room.values():
            if ci.user_id == user_id:
                return ci.team_number
        return None

    def ensure_state(self, session_code: str, topic: str | None = None) -> RoomState:
        state = self._state.get(session_code)
        if state is None or state.ended:
            state = RoomState(session_code, topic)
            self._state[session_code] = state
        elif topic is not None:
            state.topic = topic
        return state

    def get_state(self, session_code: str) -> RoomState | None:
        return self._state.get(session_code)

    def drop_state(self, session_code: str) -> None:
        self._state.pop(session_code, None)

    async def send_personal(self, ws: WebSocket, event: str, payload: Any = None) -> None:
        try:
            await ws.send_json({"event": event, "payload": payload})
        except Exception as exc:
            logger.warning("send_personal failed: %s", exc)

    async def broadcast(self, session_code: str, event: str, payload: Any = None) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values()]
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json({"event": event, "payload": payload})
            except Exception as exc:
                logger.warning("broadcast send failed: %s", exc)
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_code, ws)

    async def broadcast_to_team(self, session_code: str, team_number: int, event: str, payload: Any = None) -> None:
        """Broadcast only to WebSocket connections belonging to a specific team."""
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values() if ci.team_number == team_number or ci.role == "admin"]
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json({"event": event, "payload": payload})
            except Exception as exc:
                logger.warning("broadcast_to_team send failed: %s", exc)
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_code, ws)

    async def broadcast_to_admin(self, session_code: str, event: str, payload: Any = None) -> None:
        """Broadcast only to admin connections."""
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values() if ci.role == "admin"]
        for ws in targets:
            try:
                await ws.send_json({"event": event, "payload": payload})
            except Exception as exc:
                logger.warning("broadcast_to_admin send failed: %s", exc)


manager = GDLiveConnectionManager()


_RELAY_EVENTS = {
    "RAISE_HAND",
    "READY",
    "CHAT_MESSAGE",
    "START_GD",
    "PAUSE_GD",
    "RESUME_GD",
    "END_GD",
    "RESET_TIMER",
    "MUTE_PARTICIPANT",
    "REMOVE_PARTICIPANT",
    "AUDIO_CHUNK",
    "SPEAKER_FINISHED",
}


@router.websocket("/{session_code}")
async def gd_live_socket(
    websocket: WebSocket,
    session_code: str,
    token: str | None = Query(default=None),
):
    user = _auth_user(token)
    if not user:
        await websocket.accept()
        await websocket.send_json({"event": "ERROR", "payload": {"detail": "Unauthorized"}})
        await websocket.close()
        return

    await websocket.accept()

    user_id = user["id"]
    role = user.get("role", "student")
    name = user.get("name")

    # Determine team_number from DB
    connection: MySQLConnection = next(get_db())
    team_number = None
    try:
        participants = queries.get_live_participants(connection, session_code)
        for p in participants:
            if p["user_id"] == user_id:
                team_number = p.get("team_number")
                break
    finally:
        _return(connection)

    await manager.connect(session_code, websocket, user_id, role, name, team_number)
    logger.warning("WS CONNECT uid=%s room=%s team=%s", user_id, session_code, team_number)

    # Build/sync room state from the database.
    connection = next(get_db())
    try:
        session = queries.get_live_session_by_code(connection, session_code)
        topic = queries.get_live_team_topic(connection, session_code)
        participants_list = _participant_snapshot(connection, session_code)
    except Exception as _exc:
        logger.warning("WS state build error: %s", repr(_exc))
        session, topic, participants_list = None, None, []
    finally:
        _return(connection)

    state = manager.ensure_state(session_code, topic)
    state.ended = bool(session and session["status"] == "completed")
    for p in participants_list:
        uid = p["user_id"]
        state.participants.setdefault(uid, {})
        state.participants[uid].update(
            {
                "name": p.get("name"),
                "label": p.get("anonymous_label"),
                "team_number": p.get("team_number"),
                "status": p.get("status"),
            }
        )

    # Initialize TeamState for each team from DB
    teams_from_db = queries.get_live_teams(connection, session_code) if session else []
    team_topic_map = {t["team_number"]: t["topic"] for t in teams_from_db}
    for p in participants_list:
        tn = p.get("team_number")
        if tn and tn not in state.team_states:
            members = [m for m in participants_list if m.get("team_number") == tn]
            t_topic = team_topic_map.get(tn, topic or "")
            state.ensure_team(tn, t_topic, members)

    # Send snapshot
    await manager.send_personal(websocket, "STATE_SYNC", state.snapshot())

    # Broadcast presence
    await manager.broadcast(
        session_code,
        "PARTICIPANT_JOINED",
        {
            "user_id": user_id,
            "name": name,
            "role": role,
            "team_number": team_number,
            "label": state.participants.get(user_id, {}).get("label"),
        },
    )
    await manager.broadcast(
        session_code,
        "PARTICIPANTS_UPDATED",
        {"participants": participants_list},
    )

    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get("payload", {}) or {}

            # Handle binary audio chunks
            if event == "AUDIO_CHUNK":
                # Relay to AI evaluation service (or store for later batch processing)
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    text = payload.get("text", "")
                    if text:
                        ts.transcripts.setdefault(user_id, "")
                        ts.transcripts[user_id] += text + " "
                continue

            if event == "SPEAKER_FINISHED":
                ts = state.team_states.get(team_number) if team_number else None
                if ts and user_id not in ts.finished_user_ids:
                    ts.finished_user_ids.add(user_id)
                    if len(ts.finished_user_ids) >= len(ts.members):
                        ts.all_finished = True
                    # Broadcast updated team state
                    await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                    await manager.broadcast_to_admin(session_code, "TEAM_PROGRESS", {
                        "team_number": team_number,
                        "finished_user_ids": list(ts.finished_user_ids),
                        "all_finished": ts.all_finished,
                    })
                    if ts.all_finished:
                        # Stop the team timer
                        ts.timer_running = False
                        await manager.broadcast_to_team(session_code, team_number, "ALL_FINISHED", {
                            "session_code": session_code,
                            "team_number": team_number,
                        })
                        asyncio.create_task(_broadcast_team_results(
                            session_code, team_number, ts
                        ))
                continue

            if event not in _RELAY_EVENTS:
                continue

            is_admin = role == "admin"
            sender_id = user_id

            if event == "RAISE_HAND":
                p = state.participants.get(sender_id)
                if p is not None:
                    p["hand_raised"] = bool(payload.get("raised"))
                if team_number:
                    await manager.broadcast_to_team(session_code, team_number, "HAND_RAISED",
                        {"user_id": sender_id, "raised": bool(payload.get("raised"))})
                else:
                    await manager.broadcast(session_code, "HAND_RAISED",
                        {"user_id": sender_id, "raised": bool(payload.get("raised"))})
            elif event == "READY":
                p = state.participants.get(sender_id)
                if p is not None:
                    p["ready"] = bool(payload.get("ready"))
                await manager.broadcast(session_code, "READY_STATUS",
                    {"user_id": sender_id, "ready": bool(payload.get("ready"))})
            elif event == "CHAT_MESSAGE":
                text = str(payload.get("text", "")).strip()
                if not text:
                    continue
                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE",
                    {"user_id": sender_id, "name": name,
                     "label": state.participants.get(sender_id, {}).get("label"),
                     "text": text[:1000]})
            elif event in ("START_GD", "PAUSE_GD", "RESUME_GD", "END_GD",
                           "RESET_TIMER", "MUTE_PARTICIPANT", "REMOVE_PARTICIPANT"):
                if not is_admin:
                    await manager.send_personal(
                        websocket, "ERROR", {"detail": "Admin only action"}
                    )
                    continue
                await _handle_admin_event(manager, state, session_code, event, payload)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("ws loop error: %s", exc)
    finally:
        await manager.disconnect(session_code, websocket)
        await manager.broadcast(
            session_code,
            "PARTICIPANT_LEFT",
            {"user_id": user_id, "name": name},
        )
        await broadcast_participants(session_code)


async def _broadcast_team_results(
    session_code: str, team_number: int, ts: TeamState
) -> None:
    """Build and broadcast SESSION_RESULTS for the team once all members have finished."""
    try:
        # Build results list from stored evaluations
        results = []
        member_ids = list(ts.members.keys())
        for uid in member_ids:
            member = ts.members.get(uid, {})
            eval_data = ts.evaluations.get(uid, {})
            results.append({
                "user_id": uid,
                "name": member.get("name"),
                "label": member.get("label"),
                "overall_score": eval_data.get("overall_score", 0),
                "grammar_score": eval_data.get("grammar_score", 0),
                "confidence_score": eval_data.get("confidence_score", 0),
                "fluency_score": eval_data.get("fluency_score", 0),
                "vocabulary_score": eval_data.get("vocabulary_score", 0),
                "pronunciation_score": eval_data.get("pronunciation_score", 0),
            })

        # Broadcast results to team and admin
        await manager.broadcast_to_team(session_code, team_number, "SESSION_RESULTS", {
            "session_code": session_code,
            "team_number": team_number,
            "results": results,
        })
        await manager.broadcast_to_admin(session_code, "SESSION_RESULTS", {
            "session_code": session_code,
            "team_number": team_number,
            "results": results,
        })

        logger.info("Team %s results broadcast for session %s", team_number, session_code)
    except Exception as exc:
        logger.warning("_broadcast_team_results failed: %s", exc)


async def _handle_admin_event(
    mgr: GDLiveConnectionManager,
    state: RoomState,
    session_code: str,
    event: str,
    payload: dict,
) -> None:
    """Apply an admin-driven change to room state and broadcast it."""
    if event == "START_GD":
        state.paused = False
        await mgr.broadcast(session_code, "SESSION_RESUMED", {"status": "active"})
    elif event == "PAUSE_GD":
        state.paused = True
        await mgr.broadcast(session_code, "SESSION_PAUSED", {"status": "paused"})
    elif event == "RESUME_GD":
        state.paused = False
        await mgr.broadcast(session_code, "SESSION_RESUMED", {"status": "active"})
    elif event == "RESET_TIMER":
        await mgr.broadcast(session_code, "TIMER_UPDATED",
            {"seconds": int(payload.get("seconds", 0)), "running": False})
    elif event == "MUTE_PARTICIPANT":
        uid = int(payload.get("user_id"))
        p = state.participants.get(uid)
        if p is not None:
            p["muted"] = bool(payload.get("muted", True))
            await mgr.broadcast(session_code, "PARTICIPANT_MUTED",
                {"user_id": uid, "muted": bool(payload.get("muted", True))})
    elif event == "REMOVE_PARTICIPANT":
        uid = int(payload.get("user_id"))
        state.participants.pop(uid, None)
        await mgr.broadcast(session_code, "PARTICIPANT_REMOVED", {"user_id": uid})
    elif event == "END_GD":
        state.ended = True
        await mgr.broadcast(session_code, "SESSION_ENDED", {"session_code": session_code})
        mgr.drop_state(session_code)
