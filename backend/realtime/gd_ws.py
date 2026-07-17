"""Realtime WebSocket hub for GD Live sessions.

Manages per-session connections and broadcasts events to all participants
connected to a session room. Used to drive the live Group Discussion room
without per-second polling.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import get_db
from backend.security import decode_token

logger = logging.getLogger("speaksense.realtime")


def _auth_user(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = int(payload.get("sub"))
    except Exception:
        return None
    try:
        connection: MySQLConnection = next(get_db())
        user = queries.get_user_by_id(connection, user_id)
        connection.close()
        return user
    except Exception:
        return None

router = APIRouter(prefix="/ws/gd-live", tags=["GD Live Realtime"])


class GDLiveConnectionManager:
    """Holds active WebSocket connections keyed by session_code."""

    def __init__(self) -> None:
        # session_code -> set of WebSocket
        self._rooms: dict[str, set[WebSocket]] = {}
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

    async def send_personal(self, ws: WebSocket, event: str, payload: Any = None) -> None:
        try:
            await ws.send_json({"event": event, "payload": payload})
        except Exception as exc:  # pragma: no cover - network errors
            logger.warning("send_personal failed: %s", exc)

    async def broadcast(self, session_code: str, event: str, payload: Any = None) -> None:
        async with self._lock:
            targets = list(self._rooms.get(session_code, set()))
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json({"event": event, "payload": payload})
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_code, ws)


manager = GDLiveConnectionManager()


def _auth_user(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        return decode_token(token)
    except Exception:
        return None


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

    # Tell the room someone joined (presence)
    try:
        connection: MySQLConnection = next(get_db())
        participant = queries.fetch_one(
            connection,
            "SELECT id, team_number, anonymous_label, status FROM gd_live_participants "
            "WHERE session_code = %s AND user_id = %s",
            (session_code, user["id"]),
        )
        connection.close()
    except Exception:
        participant = None

    await manager.broadcast(
        session_code,
        "PARTICIPANT_JOINED",
        {
            "user_id": user["id"],
            "name": user.get("name"),
            "role": user.get("role"),
            "team_number": participant.get("team_number") if participant else None,
            "label": participant.get("anonymous_label") if participant else None,
        },
    )

    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get("payload", {})
            if event in (
                "MIC_TOGGLED",
                "CAMERA_TOGGLED",
                "HAND_RAISED",
                "SPEAKER_CHANGED",
                "CHAT_MESSAGE",
            ):
                # Attach sender identity and relay to the room
                payload = dict(payload or {})
                payload["user_id"] = user["id"]
                payload["name"] = user.get("name")
                payload["role"] = user.get("role")
                await manager.broadcast(session_code, event, payload)
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
