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
import re
import random
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import _return, get_connection
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


def _fetch_participants_and_counts(session_code: str) -> tuple[list[dict], dict]:
    conn = get_connection()
    try:
        # 1. Fetch joined participants (status != 'invited')
        joined = queries.get_live_participants(conn, session_code)
        
        # 2. Fetch total and not_joined counts by scanning gd_live_participants table
        row = queries.fetch_one(conn,
            "SELECT "
            "  COUNT(*) AS total_assigned, "
            "  SUM(CASE WHEN status = 'invited' THEN 1 ELSE 0 END) AS not_joined "
            "FROM gd_live_participants WHERE session_code = %s",
            (session_code,))
        if row:
            total_assigned = int(row["total_assigned"] or 0)
            not_joined = int(row["not_joined"] or 0)
        else:
            total_assigned = len(joined)
            not_joined = 0
            
        counts = {
            "total_assigned": total_assigned,
            "joined": len(joined),
            "not_joined": not_joined
        }
        return joined, counts
    finally:
        _return(conn)


async def broadcast_participants_with_checks(session_code: str, state: RoomState) -> None:
    try:
        joined_list, counts = await asyncio.to_thread(_fetch_participants_and_counts, session_code)
        participants_snapshot = []
        for p in joined_list:
            uid = p["user_id"]
            transient_p = state.participants.get(uid, {})
            participants_snapshot.append({
                "user_id": uid,
                "name": p.get("name"),
                "anonymous_label": p.get("anonymous_label"),
                "status": p.get("status"),
                "team_number": p.get("team_number"),
                "ready": transient_p.get("ready", False),
                "mic": transient_p.get("mic", True),
                "network": transient_p.get("network", "Good")
            })
        await manager.broadcast(session_code, "PARTICIPANTS_UPDATED", {
            "participants": participants_snapshot,
            "counts": counts
        })
    except Exception as exc:
        logger.warning("broadcast_participants_with_checks failed: %s", exc)


async def broadcast_participants(session_code: str) -> None:
    state = manager.get_state(session_code)
    if state is None:
        state = manager.ensure_state(session_code)
    await broadcast_participants_with_checks(session_code, state)



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


def generate_moderator_comment(name: str, transcript: str, topic: str) -> str:
    text = transcript.lower()
    topic_lower = topic.lower()
    if "competition" in topic_lower:
        if "stress" in text or "anxiety" in text or "pressure" in text or "mental" in text:
            return f"🤖 AI Moderator: {name} brought up the mental health aspect of competition, stating it creates stress. Who wants to counter this or suggest how we can make competition healthy?"
        elif "innovation" in text or "improve" in text or "grow" in text or "motivate" in text or "perform" in text:
            return f"🤖 AI Moderator: {name} argues that competition drives innovation and personal growth. Can anyone explain if cooperation or teamwork is more effective?"
        else:
            return f"🤖 AI Moderator: {name} shared a valuable viewpoint on competition. Let's hear another participant's perspective on this."
    else:
        if "replace" in text or "teacher" in text or "human" in text or "school" in text:
            return f"🤖 AI Moderator: {name} raised points about AI replacing teachers. Can someone share a counter-argument or real-life example?"
        return f"🤖 AI Moderator: {name} presented a key angle. Can anyone add a real-life example or challenge this point?"


async def compile_and_broadcast_final_summary(session_code: str, team_number: int, ts: TeamState) -> None:
    await asyncio.sleep(4)
    key_points = [
        "Encourages collaborative dialogue and consensus building",
        "Demonstrates structured argumentation and perspective taking",
        "Highlights key topic stances clearly and succinctly",
        "Engages teammates with agree/disagree voting responses"
    ]

    results = []
    connection = get_connection()
    try:
        db_evals = queries.get_live_leaderboard(connection, session_code)
        team_evals = {e["user_id"]: e for e in db_evals if e["team_number"] == team_number}
    except Exception as exc:
        logger.warning("Summary results query failed: %s", exc)
        team_evals = {}
    finally:
        _return(connection)

    for uid, member in ts.members.items():
        db_eval = team_evals.get(uid)
        mem_eval = ts.evaluations.get(uid, {
            "overall_score": 75.0, "grammar_score": 75.0, "confidence_score": 75.0,
            "fluency_score": 75.0, "vocabulary_score": 75.0, "pronunciation_score": 75.0,
        })

        overall_val = float(db_eval["overall_score"] if db_eval else mem_eval.get("overall_score", 75.0))
        grammar_val = float(db_eval["grammar_score"] if db_eval else mem_eval.get("grammar_score", 75.0))
        fluency_val = float(db_eval["fluency_score"] if db_eval else mem_eval.get("fluency_score", 75.0))
        pronunciation_val = float(db_eval["accent_score"] if db_eval else mem_eval.get("pronunciation_score", 75.0))
        relevance_val = float(db_eval["relevance_score"] if db_eval else mem_eval.get("relevance_score", 75.0))
        content_quality_val = float(db_eval["content_quality"] if db_eval else mem_eval.get("content_quality_score", 75.0))
        confidence_val = float(db_eval.get("confidence_score", overall_val) if db_eval else mem_eval.get("confidence_score", 75.0))
        vocabulary_val = float(db_eval.get("vocabulary_score", 75.0) if db_eval else mem_eval.get("vocabulary_score", 75.0))
        critical_thinking_val = float(db_eval.get("critical_thinking_score", 75.0) if db_eval else 75.0)
        topic_understanding_val = float(db_eval.get("topic_understanding_score", 75.0) if db_eval else 75.0)

        transcript_text = ts.transcripts.get(uid, "")
        word_count = len(transcript_text.split()) if transcript_text else 0

        results.append({
            "user_id": uid,
            "name": member.get("name"),
            "label": member.get("anonymous_label"),
            "overall_score": overall_val,
            "grammar_score": grammar_val,
            "fluency_score": fluency_val,
            "pronunciation_score": pronunciation_val,
            "relevance_score": relevance_val,
            "content_quality": content_quality_val,
            "confidence_score": confidence_val,
            "vocabulary_score": vocabulary_val,
            "critical_thinking_score": critical_thinking_val,
            "topic_understanding_score": topic_understanding_val,
            "word_count": word_count,
        })

    results.sort(key=lambda r: r.get("overall_score", 0), reverse=True)
    for rank, r in enumerate(results, 1):
        r["rank"] = rank

    await manager.broadcast_to_team(session_code, team_number, "SESSION_RESULTS", {
        "session_code": session_code,
        "team_number": team_number,
        "results": results,
        "key_points": key_points,
    })
    await manager.broadcast_to_admin(session_code, "SESSION_RESULTS", {
        "session_code": session_code,
        "team_number": team_number,
        "results": results,
    })
    logger.info("Final summary broadcast team=%s session=%s", team_number, session_code)


async def silence_detector_task(session_code: str, team_number: int, ts: TeamState) -> None:
    """Background task that monitors speaker activity and auto-advances on silence."""
    try:
        while not ts.all_finished and ts.timer_running:
            await asyncio.sleep(5)
            if ts.paused:
                continue
            elapsed = time.time() - ts.last_activity_time if ts.last_activity_time else 0
            if elapsed > ts.speaking_time + 10:
                logger.info("Silence timeout team=%s uid=%s elapsed=%.1f", team_number, ts.get_current_speaker_id(), elapsed)
                next_id = ts.advance_speaker()
                if next_id:
                    next_name = ts.members.get(next_id, {}).get("name", "Student")
                    ts.last_activity_time = time.time()
                    await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                        "current_speaker_id": next_id,
                        "next_speaker_id": ts.get_current_speaker_id(),
                        "round": ts.round,
                        "topic": ts.topic,
                        "speaking_time": ts.speaking_time,
                    })
                    await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                        "user_id": 0,
                        "name": "AI Moderator",
                        "label": "🤖 Moderator",
                        "text": f"⏰ Time's up! {next_name}, you have {ts.speaking_time} seconds. Begin!",
                    })
                    await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                else:
                    ts.round = 3
                    ts.all_finished = True
                    ts.timer_running = False
                    asyncio.create_task(compile_and_broadcast_final_summary(session_code, team_number, ts))
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.warning("silence_detector_task error: %s", exc)


def check_ai_moderator_rules(transcript: str, topic: str) -> str | None:
    """Check transcript for discussion rule violations and return a moderator message if found."""
    text = transcript.lower()
    if len(transcript.split()) < 5:
        return "🤖 Moderator: Your response seems very short. Could you elaborate more on your point?"
    if text.count("i think") > 3 or text.count("i believe") > 3:
        return "🤖 Moderator: Try to support your观点 with evidence or examples rather than just stating opinions."
    if "off topic" in text or "unrelated" in text:
        return "🤖 Moderator: Let's keep the discussion focused on the topic at hand."
    return None


def calculate_live_metrics(ts: TeamState) -> dict:
    """Calculate real-time metrics for a team's discussion state."""
    total_words = 0
    per_user_words = {}
    speaking_distribution = {}
    active_speakers = 0

    for uid, transcript in ts.transcripts.items():
        wc = len(transcript.split()) if transcript else 0
        per_user_words[uid] = wc
        total_words += wc
        if wc > 0:
            active_speakers += 1

    member_count = len(ts.members) if ts.members else 1
    avg_words = total_words / member_count if member_count > 0 else 0

    for uid, wc in per_user_words.items():
        speaking_distribution[uid] = round((wc / total_words * 100) if total_words > 0 else 0, 1)

    avg_score = 0.0
    score_count = 0
    for uid, eval_data in ts.evaluations.items():
        if eval_data and eval_data.get("overall_score"):
            avg_score += eval_data["overall_score"]
            score_count += 1
    if score_count > 0:
        avg_score = round(avg_score / score_count, 1)

    return {
        "total_words": total_words,
        "avg_words_per_speaker": round(avg_words, 1),
        "active_speakers": active_speakers,
        "speaking_distribution": speaking_distribution,
        "team_average_score": avg_score,
        "round": ts.round,
        "all_finished": ts.all_finished,
    }


def _save_evaluation_db_detailed(session_code: str, user_id: int, team_number: int, transcript: str, evaluation) -> None:
    """Save detailed AI evaluation to DB using the full evaluation object."""
    connection = get_connection()
    try:
        scores = _compute_scores_sync(evaluation)
        queries.save_live_evaluation(
            connection, session_code, user_id, team_number, transcript,
            scores["overall"], scores["fluency"], scores["grammar"],
            scores["accent"], scores["relevance"], scores["quality"],
            scores["points"], scores["weaknesses"], scores["tips"],
            originality_score=getattr(evaluation, "originality_score", 85.0),
            critical_thinking_score=getattr(evaluation, "critical_thinking_score", 85.0),
            topic_understanding_score=getattr(evaluation, "topic_understanding_score", 85.0),
            voice_clarity_score=getattr(evaluation, "pronunciation_score", 85.0),
            body_language_score=85.0,
            eye_contact_score=85.0,
            confidence_score=getattr(evaluation, "confidence_score", 85.0),
            filler_words_count=getattr(evaluation, "filler_count", 0),
            speech_speed_wpm=int(getattr(evaluation, "wpm", 0)),
            pauses_count=getattr(evaluation, "long_pause_count", 0),
            missing_discussion_points="; ".join(getattr(evaluation, "missing_discussion_points", [])),
            strengths="; ".join(getattr(evaluation, "strengths", [])),
            recommendations="; ".join(getattr(evaluation, "recommendations", [])),
        )
        logger.info("Detailed evaluation saved uid=%s code=%s team=%s score=%s", user_id, session_code, team_number, scores["overall"])
    except Exception as exc:
        logger.warning("_save_evaluation_db_detailed failed: %s", exc)
    finally:
        _return(connection)


async def wait_and_broadcast_results(session_code: str, team_number: int, ts: TeamState) -> None:
    """Wait for all team members to finish, then evaluate and broadcast results."""
    try:
        timeout = 120
        elapsed = 0
        while elapsed < timeout:
            all_done = all(
                ts.transcripts.get(uid, "").strip()
                for uid in ts.members
            )
            if all_done:
                break
            await asyncio.sleep(2)
            elapsed += 2

        for uid in ts.members:
            if uid in ts.evaluations:
                continue
            transcript = ts.transcripts.get(uid, "").strip()
            if not transcript:
                ts.evaluations[uid] = {
                    "overall_score": 0.0, "grammar_score": 0.0, "confidence_score": 0.0,
                    "fluency_score": 0.0, "vocabulary_score": 0.0, "pronunciation_score": 0.0,
                }
                continue
            try:
                eval_result = await asyncio.to_thread(evaluate_transcript, transcript)
                ts.evaluations[uid] = {
                    "overall_score": round(eval_result.overall_score, 1),
                    "grammar_score": round(eval_result.grammar_score, 1),
                    "confidence_score": round(eval_result.confidence_score, 1),
                    "fluency_score": round(eval_result.fluency_score, 1),
                    "vocabulary_score": round(eval_result.vocabulary_score, 1),
                    "pronunciation_score": round(eval_result.pronunciation_score, 1),
                }
                await asyncio.to_thread(_save_evaluation_db_detailed, session_code, uid, team_number, transcript, eval_result)
            except Exception as exc:
                logger.warning("wait_and_broadcast_results eval failed uid=%s: %s", uid, exc)
                ts.evaluations[uid] = {
                    "overall_score": 50.0, "grammar_score": 50.0, "confidence_score": 50.0,
                    "fluency_score": 50.0, "vocabulary_score": 50.0, "pronunciation_score": 50.0,
                }

        await _broadcast_team_results(session_code, team_number, ts)
    except Exception as exc:
        logger.warning("wait_and_broadcast_results failed: %s", exc)


class TeamState:
    """Transient per-team state for a GD Live session."""

    def __init__(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 60):
        self.team_number = team_number
        self.topic = topic
        self.members: dict[int, dict] = {m["user_id"]: m for m in members}
        self.round = 2
        self.speaking_time = speaking_time
        self.transcripts: dict[int, str] = {}
        self.evaluations: dict[int, dict] = {}
        self.ready_users: set[int] = set()
        self.mic_checks: dict[int, bool] = {}
        self.network_health: dict[int, str] = {}
        self.speaker_order: list[int] = list(self.members.keys())
        self.current_speaker_index = 0
        self.all_finished = False
        self.timer_running = False
        self.last_activity_time: float = 0.0
        self.silence_task: asyncio.Task | None = None

    def start_discussion(self) -> None:
        random.shuffle(self.speaker_order)
        self.current_speaker_index = 0
        self.round = 2
        self.timer_running = True
        self.all_finished = False
        self.last_activity_time = time.time()

    def get_current_speaker_id(self) -> int | None:
        if self.current_speaker_index < len(self.speaker_order):
            return self.speaker_order[self.current_speaker_index]
        return None

    def advance_speaker(self) -> int | None:
        self.current_speaker_index += 1
        if self.current_speaker_index < len(self.speaker_order):
            self.last_activity_time = time.time()
            return self.speaker_order[self.current_speaker_index]
        return None

    def snapshot(self) -> dict:
        current_id = self.get_current_speaker_id()
        next_index = self.current_speaker_index + 1
        next_id = self.speaker_order[next_index] if next_index < len(self.speaker_order) else None
        return {
            "team_number": self.team_number,
            "topic": self.topic,
            "round": self.round,
            "speaking_time": self.speaking_time,
            "current_speaker_id": current_id,
            "next_speaker_id": next_id,
            "timer_running": self.timer_running,
            "all_finished": self.all_finished,
            "members": {
                uid: {
                    "name": m.get("name"),
                    "label": m.get("anonymous_label"),
                    "ready": uid in self.ready_users,
                    "transcript_len": len(self.transcripts.get(uid, "")),
                    "evaluated": uid in self.evaluations,
                }
                for uid, m in self.members.items()
            },
        }


class RoomState:
    """Transient per-room state for a GD Live session."""

    def __init__(self, session_code: str, topic: str | None = None):
        self.session_code = session_code
        self.topic = topic or ""
        self.participants: dict[int, dict] = {}
        self.team_states: dict[int, TeamState] = {}
        self.paused = False
        self.ended = False
        self.speaking_time: int = 120

    def ensure_team(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 60) -> TeamState:
        if team_number not in self.team_states:
            self.team_states[team_number] = TeamState(team_number, topic, members, speaking_time)
        return self.team_states[team_number]

    def snapshot(self) -> dict:
        return {
            "session_code": self.session_code,
            "topic": self.topic,
            "paused": self.paused,
            "ended": self.ended,
            "speaking_time": self.speaking_time,
            "participants": {
                uid: {
                    "name": p.get("name"),
                    "label": p.get("label"),
                    "team_number": p.get("team_number"),
                    "ready": p.get("ready", False),
                    "hand_raised": p.get("hand_raised", False),
                    "muted": p.get("muted", False),
                }
                for uid, p in self.participants.items()
            },
            "teams": {tn: ts.snapshot() for tn, ts in self.team_states.items()},
        }


class ClientInfo:
    """Metadata for a single WebSocket connection."""

    def __init__(self, websocket: WebSocket, user_id: int, role: str, name: str, team_number: int | None = None):
        self.websocket = websocket
        self.user_id = user_id
        self.role = role
        self.name = name
        self.team_number = team_number


class GDLiveConnectionManager:
    """Manages WebSocket connections per session and per team."""

    def __init__(self):
        self._rooms: dict[str, dict[WebSocket, ClientInfo]] = {}
        self._states: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()
        self._silence_tasks: dict[str, asyncio.Task] = {}

    async def connect(self, session_code: str, websocket: WebSocket, user_id: int, role: str, name: str, team_number: int | None = None) -> ClientInfo:
        await websocket.accept()
        ci = ClientInfo(websocket, user_id, role, name, team_number)
        async with self._lock:
            self._rooms.setdefault(session_code, {})[websocket] = ci
        return ci

    async def disconnect(self, session_code: str, websocket: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            room.pop(websocket, None)
            if not room:
                self._rooms.pop(session_code, None)

    async def get_user_team(self, session_code: str, user_id: int) -> int | None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            for ci in room.values():
                if ci.user_id == user_id:
                    return ci.team_number
        return None

    async def set_client_teams(self, session_code: str, team_map: dict[int, int]) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            for ci in room.values():
                if ci.user_id in team_map:
                    ci.team_number = team_map[ci.user_id]

    def ensure_state(self, session_code: str, topic: str | None = None) -> RoomState:
        if session_code not in self._states:
            self._states[session_code] = RoomState(session_code, topic)
        return self._states[session_code]

    def get_state(self, session_code: str) -> RoomState | None:
        return self._states.get(session_code)

    def drop_state(self, session_code: str) -> None:
        self._states.pop(session_code, None)

    async def send_personal(self, websocket: WebSocket, event: str, payload: dict) -> None:
        try:
            await websocket.send_json({"event": event, "payload": payload})
        except Exception:
            pass

    async def broadcast(self, session_code: str, event: str, payload: dict) -> None:
        async with self._lock:
            room = list(self._rooms.get(session_code, {}).values())
        for ci in room:
            try:
                await ci.websocket.send_json({"event": event, "payload": payload})
            except Exception:
                pass

    async def broadcast_to_team(self, session_code: str, team_number: int, event: str, payload: dict) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
        for ci in room.values():
            if ci.team_number == team_number:
                try:
                    await ci.websocket.send_json({"event": event, "payload": payload})
                except Exception:
                    pass

    async def broadcast_to_admin(self, session_code: str, event: str, payload: dict) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
        for ci in room.values():
            if ci.role == "admin":
                try:
                    await ci.websocket.send_json({"event": event, "payload": payload})
                except Exception:
                    pass


manager = GDLiveConnectionManager()


_RELAY_EVENTS = {
    "AUDIO_CHUNK", "LIVE_SPEECH", "SPEAKER_FINISHED",
    "SUBMIT_READY_STATUS", "RAISE_HAND", "READY", "CHAT_MESSAGE",
}


@router.websocket("/ws/{session_code}")
async def gd_live_ws(websocket: WebSocket, session_code: str, token: str = Query(...)):
    user_data = _auth_user(token)
    if not user_data:
        await websocket.accept()
        await websocket.close(code=4001, reason="Unauthorized")
        return

    user_id = user_data["id"]
    name = user_data.get("name", "Student")
    role = user_data.get("role", "student")

    state = manager.ensure_state(session_code)

    existing_team = await manager.get_user_team(session_code, user_id)
    client_info = await manager.connect(session_code, websocket, user_id, role, name, existing_team)

    try:
        participant = state.participants.get(user_id, {})
        team_number = participant.get("team_number") or client_info.team_number

        await manager.send_personal(websocket, "SNAPSHOT", state.snapshot())

        await manager.broadcast(session_code, "PARTICIPANT_JOINED", {
            "user_id": user_id, "name": name, "team_number": team_number,
        })

        await broadcast_participants_with_checks(session_code, state)

        while True:
            data = await websocket.receive_json()
            event = data.get("event", "")
            payload = data.get("payload", {})

            if event == "AUDIO_CHUNK":
                continue

            if event == "LIVE_SPEECH":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    text = payload.get("text", "").strip()
                    if text:
                        existing = ts.transcripts.get(user_id, "")
                        ts.transcripts[user_id] = (existing + " " + text).strip()
                        ts.last_activity_time = time.time()
                continue

            if event == "SPEAKER_FINISHED":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    current_speaker_id = ts.get_current_speaker_id()
                    if current_speaker_id == user_id:
                        transcript = payload.get("transcript", "").strip()
                        logger.info("[SPEAKER_FINISHED] uid=%s payload_transcript_len=%d", user_id, len(transcript))
                        if not transcript or len(transcript) < 5:
                            fallback = ts.transcripts.get(user_id, "").strip()
                            logger.info("[SPEAKER_FINISHED] Using fallback from ts.transcripts: len=%d preview=%s", len(fallback), fallback[:100])
                            transcript = fallback or "[No speech recorded]"

                        ts.transcripts[user_id] = transcript

                        asyncio.create_task(_save_evaluation_db_detailed(session_code, user_id, team_number, transcript, None))

                        moderator_msg = generate_moderator_comment(ts.members.get(user_id, {}).get("name", "Student"), transcript, ts.topic)
                        if moderator_msg:
                            asyncio.create_task(manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": moderator_msg,
                            }))

                        next_speaker_id = ts.advance_speaker()
                        if next_speaker_id:
                            next_name = ts.members.get(next_speaker_id, {}).get("name", "Student")
                            ts.last_activity_time = time.time()
                            await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                "current_speaker_id": next_speaker_id,
                                "next_speaker_id": ts.get_current_speaker_id(),
                                "round": ts.round,
                                "topic": ts.topic,
                                "speaking_time": 60,
                            })
                            await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0,
                                "name": "AI Moderator",
                                "label": "🤖 Moderator",
                                "text": f"{next_name}, you have 60 seconds. Begin!",
                            })
                        else:
                            ts.round = 3
                            ts.all_finished = True
                            ts.timer_running = False
                            asyncio.create_task(compile_and_broadcast_final_summary(session_code, team_number, ts))

                        await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                continue

            if event not in _RELAY_EVENTS:
                continue

            is_admin = role == "admin"
            sender_id = user_id

            if event == "SUBMIT_READY_STATUS":
                ready = payload.get("ready", False)
                mic = payload.get("mic", True)
                network = payload.get("network", "Good")
                
                if sender_id in state.participants:
                    state.participants[sender_id]["ready"] = ready
                    state.participants[sender_id]["mic"] = mic
                    state.participants[sender_id]["network"] = network

                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    if ready:
                        ts.ready_users.add(sender_id)
                    else:
                        ts.ready_users.discard(sender_id)
                    ts.mic_checks[sender_id] = mic
                    ts.network_health[sender_id] = network
                    await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                
                await broadcast_participants_with_checks(session_code, state)

                async with manager._lock:
                    room_clients = manager._rooms.get(session_code, {})
                    connected_students = [ci for ci in room_clients.values() if ci.role == "student"]
                
                if len(connected_students) >= 2:
                    all_students_ready = True
                    for student in connected_students:
                        student_p = state.participants.get(student.user_id, {})
                        if not student_p.get("ready", False):
                            all_students_ready = False
                            break
                    
                    if all_students_ready:
                        already_started = any(ts.round >= 2 for ts in state.team_states.values())

                        if not already_started and not state.team_states:
                            try:
                                from backend.api.gd_live import _host_meeting_db_work
                                res = await asyncio.to_thread(_host_meeting_db_work, session_code)
                                if "error" not in res:
                                    topic = res["topic"]
                                    members = res["members"]
                                    
                                    state.topic = topic
                                    state.team_states.clear()
                                    
                                    t_topic_map = {}
                                    try:
                                        conn_temp = get_connection()
                                        db_teams = queries.get_live_teams(conn_temp, session_code)
                                        t_topic_map = {t["team_number"]: t["topic"] for t in db_teams}
                                    except: pass
                                    finally:
                                        if 'conn_temp' in locals() and conn_temp: _return(conn_temp)

                                    for p in members:
                                        state.participants.setdefault(p["user_id"], {})
                                        state.participants[p["user_id"]].update({
                                            "name": p["name"],
                                            "label": p["label"],
                                            "team_number": p.get("team_number"),
                                            "status": p["status"],
                                            "ready": True,
                                        })
                                        
                                        tn = p.get("team_number")
                                        if tn and tn not in state.team_states:
                                            team_members = [m for m in members if m.get("team_number") == tn]
                                            t_topic = t_topic_map.get(tn, topic or "")
                                            
                                            speaking_time = 120
                                            try:
                                                conn_time = get_connection()
                                                s_details = queries.get_live_session_by_code(conn_time, session_code)
                                                if s_details: speaking_time = s_details.get("speaking_time", 120)
                                            except: pass
                                            finally:
                                                if 'conn_time' in locals() and conn_time: _return(conn_time)
                                                
                                            state.ensure_team(tn, t_topic, team_members, speaking_time=speaking_time)

                                    for tn, ts in state.team_states.items():
                                        ts.start_discussion()
                                        
                                        first_speaker_id = ts.get_current_speaker_id()
                                        first_name = ts.members.get(first_speaker_id, {}).get("name", "Student") if first_speaker_id else "Student"
                                        
                                        moderator_msg = f"Welcome! Topic: '{ts.topic}'. {first_name}, you have 60 seconds. Begin!"
                                        asyncio.create_task(manager.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                                            "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": moderator_msg
                                        }))
                                        asyncio.create_task(manager.broadcast_to_team(session_code, tn, "SPEAKER_CHANGED", {
                                            "current_speaker_id": first_speaker_id,
                                            "next_speaker_id": None,
                                            "round": ts.round,
                                            "topic": ts.topic,
                                            "speaking_time": 60,
                                        }))
                                        asyncio.create_task(manager.broadcast_to_team(session_code, tn, "TEAM_STATE_UPDATED", ts.snapshot()))

                                    await manager.broadcast(session_code, "SESSION_STARTED", {"status": "active"})
                            except Exception as auto_err:
                                logger.error("Auto-start hosting failed: %s", auto_err)
                        elif not already_started:
                            try:
                                await _handle_admin_event(manager, state, session_code, "START_GD", {})
                            except Exception as auto_err:
                                logger.error("Auto-start (active) failed: %s", auto_err)

                continue

            elif event == "RAISE_HAND":
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
        if user_id in state.participants:
            state.participants[user_id]["ready"] = False
        await broadcast_participants_with_checks(session_code, state)


async def _broadcast_team_results(
    session_code: str, team_number: int, ts: TeamState
) -> None:
    """Build and broadcast SESSION_RESULTS for the team once all members have finished.

    Compares team members using topic relevance, argument quality, communication,
    fluency, grammar, pronunciation, confidence, vocabulary, and contribution quality.
    Does NOT rank a student highly merely because they spoke more.
    """
    try:
        results = []
        member_ids = list(ts.members.keys())
        for uid in member_ids:
            member = ts.members.get(uid, {})
            eval_data = ts.evaluations.get(uid, {})
            transcript_text = ts.transcripts.get(uid, "")

            word_count = len(transcript_text.split()) if transcript_text else 0
            unique_words = len(set(transcript_text.lower().split())) if transcript_text else 0
            repetition_penalty = 0
            if word_count > 20:
                unique_ratio = unique_words / word_count
                if unique_ratio < 0.35:
                    repetition_penalty = 20
                elif unique_ratio < 0.5:
                    repetition_penalty = 10

            contribution_quality = max(0, min(100, word_count * 2 - repetition_penalty)) if word_count > 5 else 0

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
                "topic_relevance_score": eval_data.get("topic_relevance_score", 0),
                "contribution_quality": contribution_quality,
                "word_count": word_count,
            })

        results.sort(key=lambda r: r.get("overall_score", 0), reverse=True)
        for rank, r in enumerate(results, 1):
            r["rank"] = rank

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
        
        for tn, ts in state.team_states.items():
            ts.start_discussion()
            
            first_speaker_id = ts.get_current_speaker_id()
            first_name = ts.members.get(first_speaker_id, {}).get("name", "Student") if first_speaker_id else "Student"
            
            moderator_msg = f"Welcome! Topic: '{ts.topic}'. {first_name}, you have 60 seconds. Begin!"
            asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                "user_id": 0,
                "name": "AI Moderator",
                "label": "🤖 Moderator",
                "text": moderator_msg
            }))
            
            asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "SPEAKER_CHANGED", {
                "current_speaker_id": first_speaker_id,
                "next_speaker_id": None,
                "round": ts.round,
                "topic": ts.topic,
                "speaking_time": 60,
            }))
            
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
        task = mgr._silence_tasks.pop(session_code, None)
        if task:
            task.cancel()
        await mgr.broadcast(session_code, "SESSION_ENDED", {"session_code": session_code})
        mgr.drop_state(session_code)
