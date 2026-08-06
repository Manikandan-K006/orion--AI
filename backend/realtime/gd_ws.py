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
    # Compile key points based on the topic
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
        
        # Calculate 10 competencies
        overall_val = float(db_eval["overall_score"] if db_eval else mem_eval.get("overall_score", 75.0))
        grammar_val = float(db_eval["grammar_score"] if db_eval else mem_eval.get("grammar_score", 75.0))
        fluency_val = float(db_eval["fluency_score"] if db_eval else mem_eval.get("fluency_score", 75.0))
        pronunciation_val = float(db_eval["accent_score"] if db_eval else mem_eval.get("pronunciation_score", 75.0))
        relevance_val = float(db_eval["relevance_score"] if db_eval else mem_eval.get("relevance_score", 75.0))
                        })

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
                
                # Broadcast PARTICIPANTS_UPDATED globally so the lobby updates instantly
                await broadcast_participants_with_checks(session_code, state)

                # ── Auto Start Logic: Check if all connected student participants are ready ──
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

            # Compute contribution quality (not just word count — penalize repetition)
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

        # Sort by overall_score descending for ranking
        results.sort(key=lambda r: r.get("overall_score", 0), reverse=True)
        for rank, r in enumerate(results, 1):
            r["rank"] = rank

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
