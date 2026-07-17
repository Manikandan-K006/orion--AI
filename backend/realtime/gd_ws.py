"""Realtime WebSocket hub for GD Live sessions.

Manages per-session connections, holds transient room state (speaker, round,
ready/hand status, mute) and broadcasts events to every connected participant
so the discussion workspace stays in sync without polling.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import _return, get_connection, get_db
from backend.security import decode_token

logger = logging.getLogger("speaksense.realtime")

router = APIRouter(prefix="/ws/gd-live", tags=["GD Live Realtime"])


def _auth_user(token: str | None) -> dict | None:
    """Validate the JWT and return the DB user record (with id/name/role)."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except Exception:
        return None
    # Open a fresh connection per request (no shared pool) so a dropped/idle
    # connection can never surface as a None _cnx and reject the socket.
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
    """Push the live participant list to every connected client in the room so the
    admin's participant view updates instantly as students join/leave — no refresh
    or re-fetch required. DB read runs off the event loop."""
    try:
        participants = await asyncio.to_thread(_fetch_participants, session_code)
    except Exception as exc:
        logger.warning("broadcast_participants failed: %s", exc)
        return
    await manager.broadcast(session_code, "PARTICIPANTS_UPDATED", {"participants": participants})


class RoomState:
    """Transient, in-memory state for one live session room."""

    def __init__(self, session_code: str, topic: str | None = None) -> None:
        self.session_code = session_code
        self.topic = topic
        self.speaker_user_id: Optional[int] = None
        self.round = 1
        self.paused = False
        self.ended = False
        # user_id -> {ready, hand_raised, muted, name, label, team, status}
        self.participants: dict[int, dict] = {}

    def snapshot(self) -> dict:
        return {
            "topic": self.topic,
            "speaker_user_id": self.speaker_user_id,
            "round": self.round,
            "paused": self.paused,
            "ended": self.ended,
            "participants": [
                {
                    "user_id": uid,
                    "name": p.get("name"),
                    "label": p.get("label"),
                    "team_number": p.get("team_number"),
                    "status": p.get("status"),
                    "ready": bool(p.get("ready")),
                    "hand_raised": bool(p.get("hand_raised")),
                    "muted": bool(p.get("muted")),
                }
                for uid, p in self.participants.items()
            ],
        }


class GDLiveConnectionManager:
    """Holds active WebSocket connections keyed by session_code."""

    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = {}
        self._state: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()

    async def connect(self, session_code: str, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms.setdefault(session_code, set()).add(ws)

    async def disconnect(self, session_code: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(session_code)
            if room and ws in room:
                room.discard(ws)
                if not room:
                    self._rooms.pop(session_code, None)

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
        except Exception as exc:  # pragma: no cover - network errors
            logger.warning("send_personal failed: %s", exc)

    async def broadcast(self, session_code: str, event: str, payload: Any = None) -> None:
        async with self._lock:
            targets = list(self._rooms.get(session_code, set()))
        logger.warning("BROADCAST %s to %d targets in room %s", event, len(targets), session_code)
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json({"event": event, "payload": payload})
            except Exception as exc:
                try:
                    with open("C:\\Users\\manii\\AppData\\Local\\Temp\\opencode\\ws_err.log", "a") as _f:
                        _f.write("BROADCAST %s failed: %r\n" % (event, exc))
                except Exception:
                    pass
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_code, ws)


manager = GDLiveConnectionManager()


# Events the server accepts from clients and relays/acts upon.
_RELAY_EVENTS = {
    "RAISE_HAND",
    "READY",
    "CHAT_MESSAGE",
    "SET_SPEAKER",
    "START_GD",
    "PAUSE_GD",
    "RESUME_GD",
    "END_GD",
    "NEXT_ROUND",
    "NEXT_SPEAKER",
    "RESET_TIMER",
    "MUTE_PARTICIPANT",
    "REMOVE_PARTICIPANT",
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
    await manager.connect(session_code, websocket)
    logger.warning("WS CONNECT uid=%s room=%s", user.get("id"), session_code)

    # Build/sync room state from the database.
    connection: MySQLConnection = next(get_db())
    try:
        session = queries.get_live_session_by_code(connection, session_code)
        topic = queries.get_live_team_topic(connection, session_code)
        participants = _participant_snapshot(connection, session_code)
        logger.warning("WS snapshot uid=%s room=%s count=%d", user.get("id"), session_code, len(participants))
    except Exception as _exc:
        logger.warning("WS state build error: %s", repr(_exc))
        session, topic, participants = None, None, []
    finally:
        _return(connection)

    state = manager.ensure_state(session_code, topic)
    state.ended = bool(session and session["status"] == "completed")
    for p in participants:
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

    # Send a full snapshot to the just-connected client.
    await manager.send_personal(websocket, "STATE_SYNC", state.snapshot())

    # Tell the room someone joined (presence) and push the fresh participant
    # list (the snapshot we just read, which already includes this join) so the
    # admin's view updates instantly — no extra DB read, no race.
    await manager.broadcast(
        session_code,
        "PARTICIPANT_JOINED",
        {
            "user_id": user["id"],
            "name": user.get("name"),
            "role": user.get("role"),
            "team_number": state.participants.get(user["id"], {}).get("team_number"),
            "label": state.participants.get(user["id"], {}).get("label"),
        },
    )
    await manager.broadcast(
        session_code,
        "PARTICIPANTS_UPDATED",
        {"participants": participants},
    )

    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get("payload", {}) or {}
            if event not in _RELAY_EVENTS:
                continue

            is_admin = user.get("role") == "admin"
            sender_id = user["id"]

            if event == "RAISE_HAND":
                p = state.participants.get(sender_id)
                if p is not None:
                    p["hand_raised"] = bool(payload.get("raised"))
                await manager.broadcast(
                    session_code,
                    "HAND_RAISED",
                    {"user_id": sender_id, "raised": bool(payload.get("raised"))},
                )
            elif event == "READY":
                p = state.participants.get(sender_id)
                if p is not None:
                    p["ready"] = bool(payload.get("ready"))
                await manager.broadcast(
                    session_code,
                    "READY_STATUS",
                    {"user_id": sender_id, "ready": bool(payload.get("ready"))},
                )
            elif event == "CHAT_MESSAGE":
                text = str(payload.get("text", "")).strip()
                if not text:
                    continue
                await manager.broadcast(
                    session_code,
                    "CHAT_MESSAGE",
                    {
                        "user_id": sender_id,
                        "name": user.get("name"),
                        "label": state.participants.get(sender_id, {}).get("label"),
                        "text": text[:1000],
                    },
                )
            elif event in ("SET_SPEAKER", "NEXT_SPEAKER", "START_GD", "PAUSE_GD",
                           "RESUME_GD", "END_GD", "NEXT_ROUND", "RESET_TIMER",
                           "MUTE_PARTICIPANT", "REMOVE_PARTICIPANT"):
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
            {"user_id": user["id"], "name": user.get("name")},
        )
        await broadcast_participants(session_code)


async def _handle_admin_event(
    mgr: GDLiveConnectionManager,
    state: RoomState,
    session_code: str,
    event: str,
    payload: dict,
) -> None:
    """Apply an admin-driven change to room state and broadcast it."""
    if event == "SET_SPEAKER":
        uid = int(payload.get("user_id")) if payload.get("user_id") is not None else None
        state.speaker_user_id = uid
        await mgr.broadcast(session_code, "SPEAKER_CHANGED", {"user_id": uid})
    elif event == "NEXT_SPEAKER":
        # Cycle to the next participant in the room.
        ids = [uid for uid in state.participants if not state.participants[uid].get("muted")]
        if ids:
            try:
                idx = ids.index(state.speaker_user_id)
                nxt = ids[(idx + 1) % len(ids)]
            except ValueError:
                nxt = ids[0]
            state.speaker_user_id = nxt
            await mgr.broadcast(session_code, "SPEAKER_CHANGED", {"user_id": nxt})
    elif event == "NEXT_ROUND":
        state.round += 1
        await mgr.broadcast(session_code, "ROUND_CHANGED", {"round": state.round})
    elif event == "START_GD":
        state.paused = False
        await mgr.broadcast(session_code, "SESSION_RESUMED", {"status": "active"})
    elif event == "PAUSE_GD":
        state.paused = True
        await mgr.broadcast(session_code, "SESSION_PAUSED", {"status": "paused"})
    elif event == "RESUME_GD":
        state.paused = False
        await mgr.broadcast(session_code, "SESSION_RESUMED", {"status": "active"})
    elif event == "RESET_TIMER":
        await mgr.broadcast(
            session_code,
            "TIMER_UPDATED",
            {"seconds": int(payload.get("seconds", 0)), "running": False},
        )
    elif event == "MUTE_PARTICIPANT":
        uid = int(payload.get("user_id"))
        p = state.participants.get(uid)
        if p is not None:
            p["muted"] = bool(payload.get("muted", True))
            await mgr.broadcast(
                session_code,
                "PARTICIPANT_MUTED",
                {"user_id": uid, "muted": bool(payload.get("muted", True))},
            )
    elif event == "REMOVE_PARTICIPANT":
        uid = int(payload.get("user_id"))
        state.participants.pop(uid, None)
        await mgr.broadcast(session_code, "PARTICIPANT_REMOVED", {"user_id": uid})
    elif event == "END_GD":
        state.ended = True
        await mgr.broadcast(session_code, "SESSION_ENDED", {"session_code": session_code})
        mgr.drop_state(session_code)
