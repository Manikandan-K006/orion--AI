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
from backend.ai.evaluation import evaluate_transcript_parallel, evaluate_transcript
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
    try:
        connection = get_connection()
    except Exception as exc:
        logger.warning("WS auth DB connection failed: %s", exc)
        return None
    try:
        return queries.get_user_by_id(connection, user_id)
    except Exception as exc:
        logger.warning("WS auth query failed: %s", exc)
        return None
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


def _compute_scores_sync(evaluation) -> dict:
    """Shared score computation — mirrors gd_live.py _compute_scores."""
    relevance = min(100, evaluation.grammar_score * 0.3 + evaluation.fluency_score * 0.3 + evaluation.confidence_score * 0.4)
    quality = min(100, evaluation.vocabulary_score * 0.5 + evaluation.overall_score * 0.5)
    accent = evaluation.pronunciation_score
    overall = round((evaluation.grammar_score + evaluation.fluency_score + accent + relevance + quality) / 5, 2)
    points = round(overall * 0.5, 2)
    weaknesses = []
    tips = []
    if evaluation.grammar_score < 70:
        weaknesses.append("Grammar needs improvement")
        tips.append("Practice sentence construction and verb tenses")
    if evaluation.fluency_score < 70:
        weaknesses.append("Fluency needs improvement")
        tips.append("Speak slowly and use filler words naturally")
    if evaluation.pronunciation_score < 70:
        weaknesses.append("Pronunciation needs improvement")
        tips.append("Practice difficult words and tongue twisters")
    if evaluation.confidence_score < 70:
        weaknesses.append("Confidence needs improvement")
        tips.append("Maintain steady pace and practice eye contact")
    if evaluation.vocabulary_score < 70:
        weaknesses.append("Vocabulary needs improvement")
        tips.append("Read widely and learn new words daily")
    if not weaknesses:
        weaknesses.append("Great overall performance!")
        tips.append("Keep up the good work and challenge yourself with harder topics")
    return {
        "overall": overall, "points": points,
        "fluency": evaluation.fluency_score, "grammar": evaluation.grammar_score,
        "accent": accent, "relevance": relevance, "quality": quality,
        "weaknesses": "; ".join(weaknesses),
        "tips": "; ".join(tips),
    }


def _save_evaluation_db(session_code: str, user_id: int, team_number: int, transcript: str) -> None:
    """Run AI evaluation (parallel) and persist to DB. Called in a thread to avoid blocking."""
    connection = get_connection()
    try:
        from backend.ai.evaluation import evaluate_transcript
        result = evaluate_transcript(transcript)
        scores = _compute_scores_sync(result)
        queries.save_live_evaluation(
            connection, session_code, user_id, team_number, transcript,
            scores["overall"], scores["fluency"], scores["grammar"],
            scores["accent"], scores["relevance"], scores["quality"],
            scores["points"], scores["weaknesses"], scores["tips"],
        )
        logger.info("Evaluation saved uid=%s code=%s team=%s score=%s", user_id, session_code, team_number, scores["overall"])
    except Exception as exc:
        logger.warning("_save_evaluation_db failed: %s", exc)
    finally:
        _return(connection)


import re
import random
import time

def generate_follow_up_question(name: str, transcript: str, topic: str) -> str:
    text = transcript.lower()
    if "technology" in text or "artificial" in text or "ai" in text or "machine" in text:
        return f"you highlighted the impact of technology. How do you propose we address the resulting concerns around data privacy, bias, and the potential displacement of workers?"
    elif "education" in text or "learn" in text or "school" in text or "university" in text or "student" in text:
        return f"you discussed the educational landscape. Can you share a concrete real-life example where these educational methodologies succeeded or failed?"
    elif "economy" in text or "money" in text or "job" in text or "capital" in text or "market" in text:
        return f"you focused on the economic implications. What regulatory frameworks or government initiatives are needed to support individuals affected by these economic shifts?"
    elif "social" in text or "youth" in text or "society" in text or "people" in text:
        return f"you mentioned the societal effects. How do we build awareness and guide the younger generation to navigate these social changes responsibly?"
    elif "environment" in text or "climate" in text or "nature" in text or "green" in text:
        return f"you addressed environmental sustainability. What individual or structural changes do you think will yield the most immediate, scalable results?"
    else:
        return f"you talked about key perspectives of the topic. Can you elaborate further on how we can implement a balanced approach to resolve the core challenges you raised?"


def check_ai_moderator_rules(user_id: int, name: str, text: str, topic: str) -> dict | None:
    words = re.findall(r'\b\w+\b', text.lower())
    topic_cleaned = re.sub(r'[^\w\s]', '', topic.lower()).strip()
    text_cleaned = re.sub(r'[^\w\s]', '', text.lower()).strip()
    
    if len(topic_cleaned) > 10 and topic_cleaned in text_cleaned:
         return {
             "user_id": user_id,
             "type": "repetition",
             "message": f"🤖 AI Moderator: Please explain your own ideas instead of repeating the topic title."
         }
         
    filler_words = ["uh", "umm", "um", "like", "actually", "basically"]
    fillers = [w for w in words if w in filler_words]
    if len(fillers) >= 4:
         return {
             "user_id": user_id,
             "type": "filler",
             "message": f"🤖 AI Moderator: {name}, try to reduce filler words like '{fillers[-1]}' to improve fluency."
         }
         
    double_words = re.search(r'\b(\w+)\s+\1\b', text.lower())
    if double_words:
         return {
             "user_id": user_id,
             "type": "grammar",
             "message": f"🤖 AI Moderator: Try using shorter sentences and improve grammatical accuracy."
         }
         
    return None


def calculate_live_metrics(text: str) -> dict:
    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)
    unique_words = len(set(words))
    
    grammar = max(65, 90 - (total_words // 20) * 2)
    filler_words = ["uh", "umm", "um", "like", "actually", "basically"]
    fillers = [w for w in words if w in filler_words]
    fluency = max(60, 85 - len(fillers) * 4)
    confidence = min(92, 70 + (total_words // 10) * 3)
    vocab = min(95, 60 + (unique_words * 2))
    quality = min(95, 65 + (total_words // 15) * 4)
    
    overall = round((grammar + fluency + confidence + vocab + quality) / 5, 1)
    
    return {
        "grammar": grammar,
        "fluency": fluency,
        "confidence": confidence,
        "vocabulary": vocab,
        "quality": quality,
        "overall": overall
    }


def _save_evaluation_db_detailed(session_code: str, user_id: int, team_number: int, transcript: str, topic: str, ts: TeamState) -> None:
    connection = get_connection()
    try:
        from backend.ai.evaluation import evaluate_transcript
        result = evaluate_transcript(transcript, topic=topic)
        scores = _compute_scores_sync(result)
        
        # Populate in-memory evaluations dict immediately to prevent race conditions
        ts.evaluations[user_id] = {
            "overall_score": float(scores["overall"]),
            "grammar_score": float(result.grammar_score),
            "confidence_score": float(result.confidence_score),
            "fluency_score": float(result.fluency_score),
            "vocabulary_score": float(result.vocabulary_score),
            "pronunciation_score": float(result.pronunciation_score),
            "originality_score": float(result.originality_score),
            "critical_thinking_score": float(result.critical_thinking_score),
            "topic_understanding_score": float(result.topic_understanding_score),
            "voice_clarity_score": float(result.pronunciation_score),
            "body_language_score": 85.0,
            "eye_contact_score": 85.0,
            "filler_words_count": len([w for w in re.findall(r'\b\w+\b', transcript.lower()) if w in ["uh", "umm", "um", "like", "actually", "basically"]]),
            "speech_speed_wpm": int(len(re.findall(r'\b\w+\b', transcript)) / 0.5) if len(transcript) > 0 else 0,
            "pauses_count": len(re.findall(r'[,\.]', transcript)),
            "weaknesses": scores["weaknesses"],
            "tips": scores["tips"],
            "strengths": "; ".join(result.strengths),
            "recommendations": "; ".join(result.recommendations),
            "missing_discussion_points": "; ".join(result.missing_discussion_points)
        }
        
        queries.save_live_evaluation(
            connection, session_code, user_id, team_number, transcript,
            scores["overall"], result.fluency_score, result.grammar_score,
            result.pronunciation_score, result.topic_relevance_score, result.content_quality_score,
            scores["points"], scores["weaknesses"], scores["tips"],
            originality_score=result.originality_score,
            critical_thinking_score=result.critical_thinking_score,
            topic_understanding_score=result.topic_understanding_score,
            voice_clarity_score=result.pronunciation_score,
            body_language_score=85.0,
            eye_contact_score=85.0,
            confidence_score=result.confidence_score,
            filler_words_count=ts.evaluations[user_id]["filler_words_count"],
            speech_speed_wpm=ts.evaluations[user_id]["speech_speed_wpm"],
            pauses_count=ts.evaluations[user_id]["pauses_count"],
            missing_discussion_points=ts.evaluations[user_id]["missing_discussion_points"],
            strengths=ts.evaluations[user_id]["strengths"],
            recommendations=ts.evaluations[user_id]["recommendations"]
        )
        logger.info("Detailed evaluation saved uid=%s code=%s team=%s score=%s", user_id, session_code, team_number, scores["overall"])
    except Exception as exc:
        logger.warning("_save_evaluation_db_detailed failed: %s", exc)
    finally:
        _return(connection)


async def wait_and_broadcast_results(session_code: str, team_number: int, ts: TeamState) -> None:
    await asyncio.sleep(4)
    connection = get_connection()
    team_evals = {}
    try:
        evals = queries.get_live_leaderboard(connection, session_code)
        team_evals = {e["user_id"]: e for e in evals if e["team_number"] == team_number}
    except Exception as exc:
        logger.warning("wait_and_broadcast_results DB query failed: %s", exc)
    finally:
        _return(connection)

    results = []
    for uid, member in ts.members.items():
        db_eval = team_evals.get(uid)
        mem_eval = ts.evaluations.get(uid, {})
        
        results.append({
            "user_id": uid,
            "name": member.get("name"),
            "label": member.get("label"),
            "overall_score": float(db_eval["overall_score"] if db_eval else mem_eval.get("overall_score", 70.0)),
            "grammar_score": float(db_eval["grammar_score"] if db_eval else mem_eval.get("grammar_score", 70.0)),
            "confidence_score": float(db_eval["confidence_score"] if db_eval else mem_eval.get("confidence_score", 70.0)),
            "fluency_score": float(db_eval["fluency_score"] if db_eval else mem_eval.get("fluency_score", 70.0)),
            "vocabulary_score": float(db_eval["content_quality"] if db_eval else mem_eval.get("vocabulary_score", 70.0)),
            "pronunciation_score": float(db_eval["accent_score"] if db_eval else mem_eval.get("pronunciation_score", 70.0)),
            "originality_score": float(db_eval.get("originality_score") if db_eval else mem_eval.get("originality_score", 75.0)),
            "critical_thinking_score": float(db_eval.get("critical_thinking_score") if db_eval else mem_eval.get("critical_thinking_score", 75.0)),
            "topic_understanding_score": float(db_eval.get("topic_understanding_score") if db_eval else mem_eval.get("topic_understanding_score", 75.0)),
            "voice_clarity_score": float(db_eval.get("voice_clarity_score") if db_eval else mem_eval.get("voice_clarity_score", 75.0)),
            "body_language_score": float(db_eval.get("body_language_score") if db_eval else mem_eval.get("body_language_score", 85.0)),
            "eye_contact_score": float(db_eval.get("eye_contact_score") if db_eval else mem_eval.get("eye_contact_score", 85.0)),
            "filler_words_count": int(db_eval.get("filler_words_count") if db_eval else mem_eval.get("filler_words_count", 0)),
            "speech_speed_wpm": int(db_eval.get("speech_speed_wpm") if db_eval else mem_eval.get("speech_speed_wpm", 0)),
            "pauses_count": int(db_eval.get("pauses_count") if db_eval else mem_eval.get("pauses_count", 0)),
            "weaknesses": db_eval.get("weaknesses") if db_eval else mem_eval.get("weaknesses", ""),
            "tips": db_eval.get("improvement_tips") if db_eval else mem_eval.get("tips", ""),
            "strengths": db_eval.get("strengths") if db_eval else mem_eval.get("strengths", ""),
            "recommendations": db_eval.get("recommendations") if db_eval else mem_eval.get("recommendations", ""),
            "missing_discussion_points": db_eval.get("missing_discussion_points") if db_eval else mem_eval.get("missing_discussion_points", "")
        })

    try:
        await manager.broadcast_to_team(session_code, team_number, "SESSION_RESULTS", {
            "session_code": session_code,
            "team_number": team_number,
            "results": results
        })
        await manager.broadcast_to_admin(session_code, "SESSION_RESULTS", {
            "session_code": session_code,
            "team_number": team_number,
            "results": results
        })
    except Exception as exc:
        logger.warning("broadcast SESSION_RESULTS failed: %s", exc)


class TeamState:
    """Per-team state for parallel discussion: timer, members, evaluation."""

    def __init__(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 120) -> None:
        self.team_number = team_number
        self.topic = topic
        self.members: dict[int, dict] = {m["user_id"]: m for m in members}
        self.finished_user_ids: set[int] = set()
        self.all_finished = False
        self.timer_seconds = speaking_time  # Use custom speaking time!
        self.timer_running = False
        self.transcripts: dict[int, str] = {}
        self.evaluations: dict[int, dict] = {}
        
        # Turn/rounds tracking
        self.speaking_order: list[int] = []
        self.current_speaker_idx: int = 0
        self.round: int = 1
        self.ai_questions: dict[int, str] = {}
        self.alert_cooldowns: dict[int, set[str]] = {}

    def start_discussion(self):
        self.speaking_order = list(self.members.keys())
        random.shuffle(self.speaking_order)
        self.current_speaker_idx = 0
        self.round = 1
        self.timer_running = True
        self.alert_cooldowns = {}

    def snapshot(self) -> dict:
        return {
            "team_number": self.team_number,
            "topic": self.topic,
            "finished_user_ids": list(self.finished_user_ids),
            "all_finished": self.all_finished,
            "timer_seconds": self.timer_seconds,
            "timer_running": self.timer_running,
            "speaking_order": self.speaking_order,
            "current_speaker_idx": self.current_speaker_idx,
            "round": self.round,
            "ai_questions": self.ai_questions,
            "members": [
                {
                    "user_id": uid,
                    "name": m.get("name"),
                    "label": m.get("label") or m.get("anonymous_label"),
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

    def ensure_team(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 120) -> TeamState:
        if team_number not in self.team_states:
            self.team_states[team_number] = TeamState(team_number, topic, members, speaking_time)
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
            await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
        except Exception as exc:
            logger.warning("send_personal failed: %s", exc)

    async def broadcast(self, session_code: str, event: str, payload: Any = None) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values()]
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
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
                await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
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
                await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
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
    "LIVE_SPEECH",
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
        teams_from_db = queries.get_live_teams(connection, session_code) if session else []
    except Exception as _exc:
        logger.warning("WS state build error: %s", repr(_exc))
        session, topic, participants_list, teams_from_db = None, None, [], []
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
    speaking_time = session.get("speaking_time", 120) if session else 120
    team_topic_map = {t["team_number"]: t["topic"] for t in teams_from_db}
    for p in participants_list:
        tn = p.get("team_number")
        if tn and tn not in state.team_states:
            members = [m for m in participants_list if m.get("team_number") == tn]
            t_topic = team_topic_map.get(tn, topic or "")
            state.ensure_team(tn, t_topic, members, speaking_time=speaking_time)

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
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    text = payload.get("text", "")
                    if text:
                        ts.transcripts.setdefault(user_id, "")
                        ts.transcripts[user_id] += text + " "
                continue

            if event == "LIVE_SPEECH":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    text = payload.get("text", "")
                    if text:
                        ts.transcripts[user_id] = text
                        
                        # Relay to all other team members so they see the live transcript scroll
                        await manager.broadcast_to_team(session_code, team_number, "LIVE_SPEECH_BROADCAST", {
                            "user_id": user_id,
                            "text": text
                        })
                        
                        # Run real-time AI Moderator rules with cooldown throttling
                        ts.alert_cooldowns.setdefault(user_id, set())
                        alert = check_ai_moderator_rules(user_id, name, text, ts.topic)
                        if alert and alert["type"] not in ts.alert_cooldowns[user_id]:
                            ts.alert_cooldowns[user_id].add(alert["type"])
                            # Send alert to team chat log
                            await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0,
                                "name": "AI Moderator",
                                "label": "⚠️ Alert",
                                "text": alert["message"]
                            })
                            # Send alert event
                            await manager.broadcast_to_team(session_code, team_number, "AI_ALERT", alert)
                            
                        # Also calculate and broadcast real-time metrics
                        scores = calculate_live_metrics(text)
                        await manager.broadcast_to_team(session_code, team_number, "LIVE_EVALUATION_UPDATE", {
                            "user_id": user_id,
                            **scores
                        })
                continue

            if event == "SPEAKER_FINISHED":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    current_speaker_id = ts.speaking_order[ts.current_speaker_idx] if ts.speaking_order else None
                    if current_speaker_id == user_id:
                        # Clear cooldowns for this user's turn
                        ts.alert_cooldowns.pop(user_id, None)
                        
                        # Check if there are more speakers in this round
                        if ts.current_speaker_idx + 1 < len(ts.speaking_order):
                            ts.current_speaker_idx += 1
                            next_speaker_id = ts.speaking_order[ts.current_speaker_idx]
                            next_speaker = ts.members[next_speaker_id]
                            next_name = next_speaker.get("name", "Student")
                            
                            # Broadcast speaker change
                            await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                "current_speaker_id": next_speaker_id,
                                "next_speaker_id": ts.speaking_order[ts.current_speaker_idx + 1] if ts.current_speaker_idx + 1 < len(ts.speaking_order) else None,
                                "round": ts.round,
                                "topic": ts.topic
                            })
                            
                            prev_name = ts.members[user_id].get("name", "Student")
                            moderator_msg = f"🤖 AI Moderator: Thank you {prev_name}. Now {next_name}, please present your opinion."
                            await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0,
                                "name": "AI Moderator",
                                "label": "🤖 Moderator",
                                "text": moderator_msg
                            })
                        else:
                            # Round is complete!
                            if ts.round == 1:
                                ts.round = 2
                                ts.current_speaker_idx = 0
                                
                                # Generate follow-up questions
                                uids = ts.speaking_order
                                list_names = [ts.members[uid].get("name", "Student") for uid in uids]
                                list_trans = [ts.transcripts.get(uid, "") for uid in uids]
                                
                                for idx_u, uid in enumerate(uids):
                                    if idx_u == 0:
                                        ts.ai_questions[uid] = generate_follow_up_question(list_names[0], list_trans[0], ts.topic)
                                    elif idx_u == 1:
                                        ts.ai_questions[uid] = f"do you agree with {list_names[0]}'s argument? Why or why not?"
                                    elif idx_u == 2:
                                        ts.ai_questions[uid] = f"how would you challenge {list_names[1]}'s perspective on this topic?"
                                    else:
                                        ts.ai_questions[uid] = f"having heard both {list_names[0]} and {list_names[2]}, which stance do you find more compelling and why?"
                                
                                # Broadcast speaker change for Round 2
                                first_speaker_id = uids[0]
                                first_speaker = ts.members[first_speaker_id]
                                first_name = first_speaker.get("name", "Student")
                                first_question = ts.ai_questions[first_speaker_id]
                                
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": first_speaker_id,
                                    "next_speaker_id": uids[1] if len(uids) > 1 else None,
                                    "round": 2,
                                    "topic": ts.topic
                                })
                                
                                moderator_msg = f"🤖 AI Moderator: Round 1 is complete. Let's move to Round 2 (Follow-up & Cross Questions). {first_name}, {first_question}"
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0,
                                    "name": "AI Moderator",
                                    "label": "🤖 Moderator",
                                    "text": moderator_msg
                                })
                            else:
                                # Round 2 complete -> All finished!
                                ts.all_finished = True
                                ts.timer_running = False
                                for uid in ts.members.keys():
                                    ts.finished_user_ids.add(uid)
                                    transcript = ts.transcripts.get(uid, "")
                                    # Save to DB in thread
                                    loop = asyncio.get_running_loop()
                                    loop.run_in_executor(None, _save_evaluation_db_detailed, session_code, uid, team_number, transcript, ts.topic, ts)
                                    
                                await manager.broadcast_to_team(session_code, team_number, "ALL_FINISHED", {
                                    "session_code": session_code,
                                    "team_number": team_number
                                })
                                asyncio.create_task(wait_and_broadcast_results(session_code, team_number, ts))
                        
                        # Broadcast team state update
                        await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
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
        
        # Initialize speaking turns for each team
        for tn, ts in state.team_states.items():
            ts.start_discussion()
            if ts.speaking_order:
                first_speaker_id = ts.speaking_order[0]
                first_speaker = ts.members[first_speaker_id]
                first_name = first_speaker.get("name", "Student")
                
                # Broadcast speaking turn details
                asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "SPEAKER_CHANGED", {
                    "current_speaker_id": first_speaker_id,
                    "next_speaker_id": ts.speaking_order[1] if len(ts.speaking_order) > 1 else None,
                    "round": 1,
                    "topic": ts.topic,
                    "speaking_time": ts.timer_seconds
                }))
                
                # Initial AI Moderator prompt in Chat
                moderator_msg = f"🤖 AI Moderator: Welcome to MZ ThinkCircle. Today's discussion topic is '{ts.topic}'. Let's begin Round 1. {first_name}, please present your opinion."
                asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                    "user_id": 0,
                    "name": "AI Moderator",
                    "label": "🤖 Moderator",
                    "text": moderator_msg
                }))
                
                # Broadcast updated team state sync
                asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "TEAM_STATE_UPDATED", ts.snapshot()))
                
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
