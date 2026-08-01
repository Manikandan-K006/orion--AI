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
        vocab_val = float(db_eval["content_quality"] if db_eval else mem_eval.get("vocabulary_score", 75.0))
        
        # Extended metrics
        originality_val = float(db_eval.get("originality_score") if db_eval and db_eval.get("originality_score") else mem_eval.get("originality_score", 82.0))
        critical_thinking_val = float(db_eval.get("critical_thinking_score") if db_eval and db_eval.get("critical_thinking_score") else mem_eval.get("critical_thinking_score", 84.0))
        topic_understanding_val = float(db_eval.get("topic_understanding_score") if db_eval and db_eval.get("topic_understanding_score") else mem_eval.get("topic_understanding_score", 85.0))
        
        # Simulated/Computed:
        communication_val = round((fluency_val + pronunciation_val + grammar_val) / 3, 1)
        listening_val = max(55.0, min(95.0, 92 - ts.interruption_counts.get(uid, 0) * 8))
        teamwork_val = max(50.0, min(96.0, 75 + len(ts.agree_disagree_votes.get(uid, {}).get("agree", set())) * 5))
        leadership_val = max(50.0, min(96.0, 70 + (10 if uid == ts.consensus_claimed_by else 0) + (ts.relevant_points_count.get(uid, 0) * 3)))
        confidence_val = float(db_eval.get("confidence_score") if db_eval and db_eval.get("confidence_score") else mem_eval.get("confidence_score", 80.0))
        creativity_val = round((originality_val + critical_thinking_val) / 2, 1)

        results.append({
            "user_id": uid,
            "name": member.get("name"),
            "label": member.get("label") or member.get("anonymous_label"),
            "overall_score": overall_val,
            "grammar": grammar_val,
            "vocabulary": vocab_val,
            "pronunciation": pronunciation_val,
            "relevance": relevance_val,
            "communication": communication_val,
            "listening": listening_val,
            "teamwork": teamwork_val,
            "leadership": leadership_val,
            "confidence": confidence_val,
            "critical_thinking": critical_thinking_val,
            "creativity": creativity_val,
            "topic_understanding": topic_understanding_val,
            "speaking_time": f"{int(ts.speaking_durations.get(uid, 0.0))}s",
            "interruption_count": ts.interruption_counts.get(uid, 0),
            "relevant_points": ts.relevant_points_count.get(uid, 0),
            "off_topic_count": ts.off_topic_count.get(uid, 0)
        })

    # Sort results to assign ranks
    results.sort(key=lambda r: r["overall_score"], reverse=True)
    for idx, r in enumerate(results, 1):
        r["rank"] = idx

    # Award designations:
    awards = {}
    if results:
        # Best Speaker: Highest Communication
        best_speaker = max(results, key=lambda r: r["communication"])
        awards["Best Speaker"] = best_speaker["user_id"]
        
        # Best Listener: Highest Listening
        best_listener = max(results, key=lambda r: r["listening"])
        awards["Best Listener"] = best_listener["user_id"]
        
        # Best Leader: Highest Leadership
        best_leader = max(results, key=lambda r: r["leadership"])
        awards["Best Leader"] = best_leader["user_id"]
        
        # Most Innovative Thinker: Highest Creativity
        most_innovative = max(results, key=lambda r: r["creativity"])
        awards["Most Innovative Thinker"] = most_innovative["user_id"]
        
        # Most Supportive Member: Highest Teamwork
        most_supportive = max(results, key=lambda r: r["teamwork"])
        awards["Most Supportive Member"] = most_supportive["user_id"]
        
    ts.awards = awards

    # Broadcast results to team and admin
    await manager.broadcast_to_team(session_code, team_number, "SESSION_RESULTS", {
        "session_code": session_code,
        "team_number": team_number,
        "results": results,
        "key_points": key_points,
        "awards": {name: ts.members[uid]["name"] for name, uid in awards.items()},
        "winner": results[0] if results else None
    })
    await manager.broadcast_to_admin(session_code, "SESSION_RESULTS", {
        "session_code": session_code,
        "team_number": team_number,
        "results": results,
        "key_points": key_points,
        "awards": {name: ts.members[uid]["name"] for name, uid in awards.items()},
        "winner": results[0] if results else None
    })


async def silence_detector_task(session_code: str):
    logger.info("Silence detector started for session %s", session_code)
    try:
        while True:
            await asyncio.sleep(1.0)
            state = manager.get_state(session_code)
            if not state or state.ended or state.paused:
                continue
            for tn, ts in state.team_states.items():
                if ts.round == 2 and ts.timer_running:
                    import time
                    now = time.time()
                    if ts.last_activity_time > 0 and (now - ts.last_activity_time) > 5.0:
                        ts.last_activity_time = now # reset
                        eligible_members = [
                            uid for uid in ts.members.keys() 
                            if uid not in ts.finished_user_ids
                        ]
                        if not eligible_members:
                            continue
                        target_uid = random.choice(eligible_members)
                        target_name = ts.members[target_uid].get("name", "Student")
                        
                        prompts = [
                            f"Would anyone like to add another point? {target_name}, what is your opinion?",
                            f"We have a slight pause here. {target_name}, can you share your thoughts on the points raised so far?",
                            f"Let's keep the momentum going. {target_name}, how would you approach this topic?",
                            f"I'd love to hear another perspective. {target_name}, what is your take on this?"
                        ]
                        prompt_text = random.choice(prompts)
                        
                        await manager.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                            "user_id": 0,
                            "name": "AI Moderator",
                            "label": "🤖 Moderator",
                            "text": prompt_text
                        })
                        await manager.broadcast_to_team(session_code, tn, "AI_MODERATOR_PROMPT", {
                            "text": prompt_text,
                            "target_user_id": target_uid
                        })
    except asyncio.CancelledError:
        logger.info("Silence detector cancelled for session %s", session_code)
    except Exception as exc:
        logger.error("Silence detector error: %s", exc)



def check_ai_moderator_rules(user_id: int, name: str, text: str, topic: str) -> dict | None:
    words = re.findall(r'\b\w+\b', text.lower())
    if not words or len(words) < 3:
        return None

    topic_words = set(re.findall(r'\b\w+\b', topic.lower()))
    stop_words = {"should", "be", "in", "the", "a", "an", "is", "are", "and", "or", "of", "to", "for", "with", "on", "at", "by", "from", "my", "your", "what", "how", "why", "can", "do", "does"}
    meaningful_topic_words = topic_words - stop_words
    
    # 1. Question Repetition Detection
    topic_cleaned = re.sub(r'[^\w\s]', '', topic.lower()).strip()
    text_cleaned = re.sub(r'[^\w\s]', '', text.lower()).strip()
    
    matched_topic_words = [w for w in words if w in meaningful_topic_words]
    unique_new_words = set(words) - stop_words - meaningful_topic_words

    # Flag if user repeats main topic keywords without adding original thoughts
    if len(meaningful_topic_words) >= 2 and len(matched_topic_words) >= max(2, int(len(meaningful_topic_words) * 0.5)) and len(unique_new_words) < 4:
        return {
            "user_id": user_id,
            "type": "repetition",
            "message": f"🤖 AI Moderator: {name}, please do not repeat the discussion question. Provide your own original points and arguments!"
        }

    if len(topic_cleaned) > 8 and topic_cleaned in text_cleaned and len(words) < len(re.findall(r'\b\w+\b', topic)) + 6:
        return {
            "user_id": user_id,
            "type": "repetition",
            "message": f"🤖 AI Moderator: {name}, please do not repeat the question! Explain your stance with your own supporting points."
        }

    # 2. Filler words detection
    filler_words = ["uh", "umm", "um", "like", "actually", "basically"]
    fillers = [w for w in words if w in filler_words]
    if len(fillers) >= 3:
        return {
            "user_id": user_id,
            "type": "filler",
            "message": f"🤖 AI Moderator: {name}, try to reduce filler words like '{fillers[-1]}' to improve your fluency."
        }

    # 3. Repeated words / grammar check
    double_words = re.search(r'\b(\w+)\s+\1\b', text.lower())
    if double_words:
        return {
            "user_id": user_id,
            "type": "grammar",
            "message": f"🤖 AI Moderator: {name}, pay attention to sentence structure and avoid repeating words like '{double_words.group(1)}'."
        }

    return None


def calculate_live_metrics(text: str) -> dict:
    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)
    unique_words = len(set(words))
    
    # Grammar & Double words check
    double_words = re.findall(r'\b(\w+)\s+\1\b', text.lower())
    grammar = max(55, min(96, 92 - len(double_words) * 6 - (total_words // 25) * 2))
    
    # Fluency & Filler words
    filler_words = ["uh", "umm", "um", "like", "actually", "basically", "you know"]
    fillers = [w for w in words if w in filler_words]
    fluency = max(50, min(98, 94 - len(fillers) * 5))
    
    # Confidence & Vocabulary
    confidence = max(55, min(95, 72 + (total_words // 8) * 3))
    vocab = max(50, min(96, 62 + (unique_words * 2.2)))
    quality = max(55, min(96, 68 + (total_words // 12) * 3.5))
    
    overall = round((grammar + fluency + confidence + vocab + quality) / 5, 1)
    
    # Emotion detection
    if any(w in text.lower() for w in ["strongly", "definitely", "certainly", "clearly", "proven"]):
        emotion = "Confident"
    elif any(w in text.lower() for w in ["however", "whereas", "statistics", "data", "reason", "impact"]):
        emotion = "Analytical"
    elif any(w in text.lower() for w in ["great", "excited", "important", "vital", "transform"]):
        emotion = "Enthusiastic"
    else:
        emotion = "Thoughtful"

    # Interaction & Speech Markers
    text_lower = text.lower()
    agreements = len(re.findall(r'\b(agree|support|second|building on|aligned)\b', text_lower))
    disagreements = len(re.findall(r'\b(disagree|however|oppose|counter|alternative|different view)\b', text_lower))
    questions_asked = text.count("?") + len(re.findall(r'\b(what do you think|how can we|why should|do you agree)\b', text_lower))
    wpm = min(180, max(90, total_words * 4))

    # Pronunciation proxy: clear delivery is penalized by double words & fillers
    pronunciation = max(55, min(96, 90 - len(double_words) * 4 - len(fillers) * 3))

    # Relevance: reward reasoning & topic-marker words that stay on-topic
    reasoning_words = ["because", "therefore", "however", "example", "for instance", "data", "statistics", "impact", "reason", "result", "benefit", "solution", "conclusion"]
    reasoning_hits = sum(1 for w in reasoning_words if w in text_lower)
    relevance = max(55, min(96, 66 + reasoning_hits * 6))

    return {
        "grammar": round(grammar, 1),
        "fluency": round(fluency, 1),
        "confidence": round(confidence, 1),
        "vocabulary": round(vocab, 1),
        "quality": round(quality, 1),
        "pronunciation": round(pronunciation, 1),
        "relevance": round(relevance, 1),
        "overall": round(overall, 1),
        "emotion": emotion,
        "wpm": wpm,
        "filler_count": len(fillers),
        "agreements": agreements,
        "disagreements": disagreements,
        "questions_asked": questions_asked,
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
            "filler_words_count": result.filler_count,
            "speech_speed_wpm": int(result.wpm),
            "pauses_count": result.long_pause_count,
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
        self.timer_seconds = speaking_time
        self.timer_running = False
        self.transcripts: dict[int, str] = {}
        self.evaluations: dict[int, dict] = {}
        
        # Turn/rounds tracking (7-stage state machine)
        self.speaking_order: list[int] = []
        self.current_speaker_idx: int = 0
        self.round: int = 1  # 1: Waiting Room, 2: AI Introduction, 3: Opening Round, 4: Intelligent Open Discussion, 5: Challenge Round, 6: Consensus, 7: Final summary
        self.ai_questions: dict[int, str] = {}
        self.alert_cooldowns: dict[int, set[str]] = {}
        self.last_speaker_id: int | None = None
        self.last_activity_time: float = 0.0
        self.moderator_interaction_count: int = 0
        self.open_discussion_speakers: list[int] = []

        # Advanced GD indicators/queues:
        self.ready_users: set[int] = set()
        self.mic_checks: dict[int, bool] = {}
        self.network_health: dict[int, str] = {}
        self.hand_raised_queue: list[int] = []
        self.rebuttal_queue: list[int] = []
        self.interruption_counts: dict[int, int] = {}
        self.speaking_durations: dict[int, float] = {}
        self.agree_disagree_votes: dict[int, dict[str, set[int]]] = {} # user_id -> {"agree": {uid1, uid2}, "disagree": {uid1}}
        self.arguments_made: dict[int, list[str]] = {}
        self.relevant_points_count: dict[int, int] = {}
        self.off_topic_count: dict[int, int] = {}
        self.live_speaking_statuses: dict[int, str] = {} # user_id -> "Speaking" | "Thinking" | "Idle"
        self.consensus_claimed_by: int | None = None
        self.consensus_text: str = ""
        self.challenge_questions: dict[int, str] = {}
        self.awards: dict[str, int] = {} # award_name -> user_id

    def start_discussion(self):
        self.speaking_order = []
        self.current_speaker_idx = 0
        self.round = 1  # Start at Stage 1: Waiting Room
        self.timer_seconds = 60
        self.timer_running = False
        self.alert_cooldowns = {}
        import time
        self.last_activity_time = time.time()
        self.last_speaker_id = None
        self.moderator_interaction_count = 0
        self.open_discussion_speakers = []
        
        self.ready_users = set()
        self.mic_checks = {}
        self.network_health = {}
        self.hand_raised_queue = []
        self.rebuttal_queue = []
        self.interruption_counts = {}
        self.speaking_durations = {}
        self.agree_disagree_votes = {}
        self.arguments_made = {}
        self.relevant_points_count = {}
        self.off_topic_count = {}
        self.live_speaking_statuses = {}
        self.consensus_claimed_by = None
        self.consensus_text = ""
        self.challenge_questions = {}
        self.awards = {}

    def snapshot(self) -> dict:
        total_time = sum(self.speaking_durations.values())
        participation_percentages = {}
        for uid in self.members.keys():
            dur = self.speaking_durations.get(uid, 0.0)
            participation_percentages[uid] = round((dur / total_time * 100), 1) if total_time > 0 else 0.0

        vote_counts = {}
        for uid, votes in self.agree_disagree_votes.items():
            vote_counts[uid] = {
                "agree": len(votes.get("agree", set())),
                "disagree": len(votes.get("disagree", set()))
            }

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
            "ready_users": list(self.ready_users),
            "mic_checks": self.mic_checks,
            "network_health": self.network_health,
            "hand_raised_queue": self.hand_raised_queue,
            "rebuttal_queue": self.rebuttal_queue,
            "interruption_counts": self.interruption_counts,
            "speaking_durations": self.speaking_durations,
            "participation_percentages": participation_percentages,
            "agree_disagree_votes": vote_counts,
            "arguments_made": self.arguments_made,
            "relevant_points_count": self.relevant_points_count,
            "off_topic_count": self.off_topic_count,
            "live_speaking_statuses": self.live_speaking_statuses,
            "challenge_questions": self.challenge_questions,
            "consensus_claimed_by": self.consensus_claimed_by,
            "consensus_text": self.consensus_text,
            "awards": self.awards,
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
        self._silence_tasks: dict[str, asyncio.Task] = {}

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

    def set_client_teams(self, session_code: str, team_by_user: dict[int, int]) -> None:
        """Update the persisted team_number on each connected client after teams
        are assigned, so team-scoped broadcasts reach the right participants."""
        room = self._rooms.get(session_code)
        if not room:
            return
        for ci in room.values():
            if ci.user_id in team_by_user:
                ci.team_number = team_by_user[ci.user_id]
        # Keep the in-memory participant registry in sync too: REST-only host
        # flows (host-meeting without the ready auto-start) never update it.
        state = self._state.get(session_code)
        if state:
            for uid, tn in team_by_user.items():
                p = state.participants.get(uid)
                if p is not None:
                    p["team_number"] = tn

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
    "SUBMIT_READY_STATUS",
    "REQUEST_REBUTTAL",
    "AGREE_DISAGREE_VOTE",
    "CLAIM_CONSENSUS_TURN",
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
    connection = None
    team_number = None
    try:
        connection = get_connection()
        participants = queries.get_live_participants(connection, session_code)
        for p in participants:
            if p["user_id"] == user_id:
                team_number = p.get("team_number")
                break
    except Exception as exc:
        logger.warning("WS team_number lookup failed: %s", exc)
    finally:
        if connection: _return(connection)

    await manager.connect(session_code, websocket, user_id, role, name, team_number)
    logger.warning("WS CONNECT uid=%s room=%s team=%s", user_id, session_code, team_number)

    # Build/sync room state from the database.
    connection = None
    try:
        connection = get_connection()
        session = queries.get_live_session_by_code(connection, session_code)
        topic = queries.get_live_team_topic(connection, session_code)
        participants_list = queries.get_live_participants(connection, session_code)
        teams_from_db = queries.get_live_teams(connection, session_code) if session else []
    except Exception as _exc:
        logger.warning("WS state build error: %s", repr(_exc))
        session, topic, participants_list, teams_from_db = None, None, [], []
    finally:
        if connection: _return(connection)

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
    await broadcast_participants_with_checks(session_code, state)

    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get("payload", {}) or {}

            # Teams are assigned AFTER students connect (host-meeting / ready
            # flow), so the connect-time team_number is stale (None). Re-resolve
            # from the in-memory participant registry on every event so
            # team-scoped handlers (LIVE_SPEECH, SPEAKER_FINISHED, AUDIO_CHUNK)
            # find the correct TeamState for pre-assignment connections.
            _pinfo = state.participants.get(user_id)
            _resolved_team = _pinfo.get("team_number") if _pinfo else None
            if _resolved_team is not None:
                team_number = _resolved_team

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
                    loop = asyncio.get_running_loop()
                    from backend.ai.evaluation import evaluate_transcript                    if ts.round == 3:
                        current_speaker_id = ts.speaking_order[ts.current_speaker_idx] if ts.speaking_order else None
                        if current_speaker_id == user_id:
                            # Clear cooldowns for this user's turn
                            ts.alert_cooldowns.pop(user_id, None)
                            
                            transcript = payload.get("transcript", "").strip()
                            if not transcript or len(transcript) < 5:
                                transcript = "[No speech recorded]"
                            
                            words = transcript.split()
                            duration = max(5.0, len(words) * 0.4)
                            ts.speaking_durations[user_id] = ts.speaking_durations.get(user_id, 0.0) + duration

                            # Dynamic check: speech too short? (less than 15 words)
                            if len(words) < 15 and not payload.get("re-speech"):
                                moderator_follow_up = generate_follow_up_question(name, transcript, ts.topic)
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0,
                                    "name": "AI Moderator",
                                    "label": "🤖 Moderator",
                                    "text": f"🤖 AI Moderator: {name}, {moderator_follow_up}"
                                })
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": user_id,
                                    "next_speaker_id": ts.speaking_order[ts.current_speaker_idx + 1] if ts.current_speaker_idx + 1 < len(ts.speaking_order) else None,
                                    "round": 3,
                                    "topic": ts.topic,
                                    "speaking_time": 15,
                                    "is_follow_up": True
                                })
                                await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                                continue
                            
                            # Perform fast evaluation
                            try:
                                result = await loop.run_in_executor(None, evaluate_transcript, transcript, None, ts.topic)
                                scores = _compute_scores_sync(result)
                                ts.relevant_points_count[user_id] = ts.relevant_points_count.get(user_id, 0) + len(result.strengths)
                                ts.off_topic_count[user_id] = ts.off_topic_count.get(user_id, 0) + (1 if result.topic_relevance_score < 70 else 0)
                                ts.arguments_made.setdefault(user_id, []).extend(result.strengths)
                                
                                queries.save_live_evaluation(
                                    get_connection(), session_code, user_id, team_number, transcript,
                                    scores["overall"], result.fluency_score, result.grammar_score,
                                    result.pronunciation_score, result.topic_relevance_score, result.content_quality_score,
                                    scores["points"], scores["weaknesses"], scores["tips"]
                                )
                                ts.evaluations[user_id] = {
                                    "overall_score": float(scores["overall"]),
                                    "grammar_score": float(result.grammar_score),
                                    "confidence_score": float(result.confidence_score),
                                    "fluency_score": float(result.fluency_score),
                                    "vocabulary_score": float(result.vocabulary_score),
                                    "pronunciation_score": float(result.pronunciation_score),
                                    "strengths": result.strengths,
                                    "weaknesses": result.weaknesses,
                                    "recommendations": result.recommendations,
                                    "feedback": result.feedback
                                }
                            except Exception as exc:
                                logger.error("Fast evaluation failed: %s", exc)
                                scores = {
                                    "overall": 75.0, "fluency": 75.0, "grammar": 75.0,
                                    "accent": 75.0, "relevance": 75.0, "quality": 75.0,
                                    "points": 37.5,
                                    "weaknesses": "Short speech recorded", "tips": "Speak clearly and practice elaboration"
                                }
                                ts.evaluations[user_id] = {
                                    "overall_score": 75.0,
                                    "grammar_score": 75.0,
                                    "confidence_score": 75.0,
                                    "fluency_score": 75.0,
                                    "vocabulary_score": 75.0,
                                    "pronunciation_score": 75.0,
                                    "strengths": ["Clear delivery"],
                                    "weaknesses": ["Improve content depth"],
                                    "recommendations": ["Elaborate on arguments"],
                                    "feedback": "Evaluation completed with fallback settings."
                                }
                            
                            ts.finished_user_ids.add(user_id)
                            
                            # Broadcast instant evaluation
                            await manager.broadcast_to_team(session_code, team_number, "SPEAKER_EVALUATED", {
                                "user_id": user_id,
                                "scores": ts.evaluations[user_id],
                                "transcript": transcript
                            })
                            
                            # Send feedback to chat
                            g_score = int(ts.evaluations[user_id]["grammar_score"])
                            c_score = int(ts.evaluations[user_id]["confidence_score"])
                            v_score = int(ts.evaluations[user_id]["vocabulary_score"])
                            f_score = int(ts.evaluations[user_id]["fluency_score"])
                            feedback_str = ts.evaluations[user_id]["feedback"]
                            short_feedback = feedback_str.split(".")[0] + "."
                            
                            moderator_feedback_msg = (
                                f"🤖 AI Moderator: {name}, Grammar: {g_score}%, Confidence: {c_score}%, "
                                f"Vocabulary: {v_score}%, Fluency: {f_score}%.\n"
                                f"AI Feedback: {short_feedback}"
                            )
                            await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0,
                                "name": "AI Moderator",
                                "label": "🤖 Moderator",
                                "text": moderator_feedback_msg
                            })

                            # Switch speaker
                            if ts.current_speaker_idx + 1 < len(ts.speaking_order):
                                ts.current_speaker_idx += 1
                                next_speaker_id = ts.speaking_order[ts.current_speaker_idx]
                                next_name = ts.members[next_speaker_id].get("name", "Student")
                                ts.last_activity_time = time.time()
                                
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": next_speaker_id,
                                    "next_speaker_id": ts.speaking_order[ts.current_speaker_idx + 1] if ts.current_speaker_idx + 1 < len(ts.speaking_order) else None,
                                    "round": 3,
                                    "topic": ts.topic,
                                    "speaking_time": 30
                                })
                                
                                moderator_msg = f"🤖 AI Moderator: Now it's {next_name}'s turn. You have 30 seconds."
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0,
                                    "name": "AI Moderator",
                                    "label": "🤖 Moderator",
                                    "text": moderator_msg
                                })
                            else:
                                # Transition to Stage 4: Intelligent Open Discussion
                                ts.round = 4
                                ts.current_speaker_idx = 0
                                ts.timer_seconds = 120
                                ts.last_activity_time = time.time()
                                ts.hand_raised_queue = []
                                ts.rebuttal_queue = []
                                
                                await manager.broadcast_to_team(session_code, team_number, "ROUND_CHANGED", {
                                    "round": 4,
                                    "topic": ts.topic,
                                    "speaking_time": 120
                                })
                                
                                moderator_msg = (
                                    "🤖 AI Moderator: The Opening Round is complete! We are now entering Stage 4: Intelligent Open Discussion. "
                                    "Please use the 'Raise Hand' or 'Request Rebuttal' buttons to claim speaking slots. Agree/Disagree voting is active."
                                )
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0,
                                    "name": "AI Moderator",
                                    "label": "🤖 Moderator",
                                    "text": moderator_msg
                                })
                            
                            await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())

                    elif ts.round == 4:
                        transcript = payload.get("transcript", "").strip()
                        if transcript and len(transcript) >= 5:
                            ts.last_activity_time = time.time()
                            words = transcript.split()
                            word_count = len(words)
                            duration = max(5.0, word_count * 0.4)
                            ts.speaking_durations[user_id] = ts.speaking_durations.get(user_id, 0.0) + duration
                            
                            # Dominance check (>45s or >80 words)
                            if duration > 45.0 or word_count > 80:
                                ts.interruption_counts[user_id] = ts.interruption_counts.get(user_id, 0) + 1
                                moderator_reply = f"🤖 AI Moderator: Thank you, {name}, for your contribution. To keep the debate fair, I must interrupt you to allow others a chance. Let's move the floor."
                            # Same speaker twice consecutively
                            elif ts.last_speaker_id == user_id:
                                moderator_reply = f"🤖 AI Moderator: {name}, you have spoken consecutively. Please allow other teammates to respond first."
                            else:
                                ts.moderator_interaction_count += 1
                                moderator_reply = generate_moderator_comment(name, transcript, ts.topic)
                            
                            ts.transcripts[user_id] = (ts.transcripts.get(user_id, "") + " " + transcript).strip()
                            ts.last_speaker_id = user_id
                            
                            try:
                                result = await loop.run_in_executor(None, evaluate_transcript, transcript, None, ts.topic)
                                scores = _compute_scores_sync(result)
                                ts.relevant_points_count[user_id] = ts.relevant_points_count.get(user_id, 0) + len(result.strengths)
                                ts.off_topic_count[user_id] = ts.off_topic_count.get(user_id, 0) + (1 if result.topic_relevance_score < 70 else 0)
                                ts.arguments_made.setdefault(user_id, []).extend(result.strengths)
                                
                                ts.evaluations[user_id] = {
                                    "overall_score": float(scores["overall"]),
                                    "grammar_score": float(result.grammar_score),
                                    "confidence_score": float(result.confidence_score),
                                    "fluency_score": float(result.fluency_score),
                                    "vocabulary_score": float(result.vocabulary_score),
                                    "pronunciation_score": float(result.pronunciation_score),
                                }
                            except Exception as exc:
                                logger.error("Open discussion evaluation failed: %s", exc)
                            
                            # Broadcast moderator reply
                            await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0,
                                "name": "AI Moderator",
                                "label": "🤖 Moderator",
                                "text": moderator_reply
                            })
                            
                            # Broadcast SPEAKER_EVALUATED
                            await manager.broadcast_to_team(session_code, team_number, "SPEAKER_EVALUATED", {
                                "user_id": user_id,
                                "scores": ts.evaluations.get(user_id, {}),
                                "transcript": transcript
                            })
                            
                            # Remove this user from queues if they were in them
                            if user_id in ts.rebuttal_queue:
                                ts.rebuttal_queue.remove(user_id)
                            if user_id in ts.hand_raised_queue:
                                ts.hand_raised_queue.remove(user_id)

                            # Determine next speaker automatically based on queues
                            next_speaker = None
                            reason = "raise hand"
                            if ts.rebuttal_queue:
                                next_speaker = ts.rebuttal_queue.pop(0)
                                reason = "rebuttal"
                            elif ts.hand_raised_queue:
                                next_speaker = ts.hand_raised_queue.pop(0)
                                reason = "raise hand"
                            
                            if next_speaker:
                                next_name = ts.members[next_speaker].get("name", "Student")
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": next_speaker,
                                    "next_speaker_id": ts.rebuttal_queue[0] if ts.rebuttal_queue else (ts.hand_raised_queue[0] if ts.hand_raised_queue else None),
                                    "round": 4,
                                    "topic": ts.topic,
                                    "speaking_time": 45,
                                    "reason": reason
                                })
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0,
                                    "name": "AI Moderator",
                                    "label": "🤖 Moderator",
                                    "text": f"🤖 AI Moderator: Floor allocated to {next_name} for a {reason}. You have 45 seconds."
                                })
                            else:
                                # Set speaker ID to null, floor is open
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": None,
                                    "next_speaker_id": None,
                                    "round": 4,
                                    "topic": ts.topic,
                                    "speaking_time": 0
                                })
                            
                            # Transition to Challenge Round after 4 interactions
                            if ts.moderator_interaction_count >= 4:
                                ts.round = 5
                                ts.current_speaker_idx = 0
                                ts.speaking_order = list(ts.members.keys())
                                random.shuffle(ts.speaking_order)
                                ts.timer_seconds = 25
                                ts.last_activity_time = time.time()
                                
                                challenge_types = [
                                    "Counter-argument challenge: Can you present a counter-argument to the point that technology alienates humans?",
                                    "Scenario question: Suppose a placement company rejects candidates using automated resumes. How do you defend candidate rights?",
                                    "Leadership challenge: If your team members disagree completely, how will you guide them to consensus?",
                                    "Problem-solving question: What immediate regulations would you pass to control data security breaches?",
                                    "Decision-making challenge: If you had to choose between absolute safety and absolute convenience, which would you pick and why?"
                                ]
                                for idx, uid in enumerate(ts.speaking_order):
                                    ts.challenge_questions[uid] = challenge_types[idx % len(challenge_types)]
                                
                                await manager.broadcast_to_team(session_code, team_number, "ROUND_CHANGED", {
                                    "round": 5,
                                    "topic": "AI Challenge Round",
                                    "speaking_time": 25
                                })
                                
                                first_challenge_speaker = ts.speaking_order[0]
                                first_challenge_name = ts.members[first_challenge_speaker].get("name", "Student")
                                first_question = ts.challenge_questions[first_challenge_speaker]
                                
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": first_challenge_speaker,
                                    "next_speaker_id": ts.speaking_order[1] if len(ts.speaking_order) > 1 else None,
                                    "round": 5,
                                    "topic": first_question,
                                    "speaking_time": 25
                                })
                                
                                challenge_msg = (
                                    f"🤖 AI Moderator: We are now entering Stage 5: AI Challenge Round! "
                                    f"I will assign scenario and leadership questions. "
                                    f"{first_challenge_name}, your question is: '{first_question}'. You have 25 seconds."
                                )
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": challenge_msg
                                })
                            
                            await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())

                    elif ts.round == 5:
                        current_speaker_id = ts.speaking_order[ts.current_speaker_idx] if ts.speaking_order else None
                        if current_speaker_id == user_id:
                            transcript = payload.get("transcript", "").strip()
                            if not transcript:
                                transcript = "[No response]"
                            
                            ts.transcripts[user_id] = (ts.transcripts.get(user_id, "") + " [Challenge]: " + transcript).strip()
                            
                            try:
                                q_text = ts.challenge_questions.get(user_id, "Challenge Question")
                                result = await loop.run_in_executor(None, evaluate_transcript, transcript, None, q_text)
                                scores = _compute_scores_sync(result)
                                ts.evaluations[user_id] = {
                                    "overall_score": float(scores["overall"]),
                                    "grammar_score": float(result.grammar_score),
                                    "confidence_score": float(result.confidence_score),
                                    "fluency_score": float(result.fluency_score),
                                    "vocabulary_score": float(result.vocabulary_score),
                                    "pronunciation_score": float(result.pronunciation_score),
                                }
                            except Exception as exc:
                                logger.error("Challenge round evaluation failed: %s", exc)
                            
                            await manager.broadcast_to_team(session_code, team_number, "SPEAKER_EVALUATED", {
                                "user_id": user_id,
                                "scores": ts.evaluations.get(user_id, {}),
                                "transcript": transcript
                            })
                            
                            if ts.current_speaker_idx + 1 < len(ts.speaking_order):
                                ts.current_speaker_idx += 1
                                next_speaker_id = ts.speaking_order[ts.current_speaker_idx]
                                next_name = ts.members[next_speaker_id].get("name", "Student")
                                q_text = ts.challenge_questions.get(next_speaker_id, "Challenge Question")
                                ts.last_activity_time = time.time()
                                
                                await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                                    "current_speaker_id": next_speaker_id,
                                    "next_speaker_id": ts.speaking_order[ts.current_speaker_idx + 1] if ts.current_speaker_idx + 1 < len(ts.speaking_order) else None,
                                    "round": 5,
                                    "topic": q_text,
                                    "speaking_time": 25
                                })
                                
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator",
                                    "text": f"🤖 AI Moderator: Next is {next_name}. Question: '{q_text}'"
                                })
                            else:
                                # Transition to Stage 6: Group Conclusion
                                ts.round = 6
                                ts.current_speaker_idx = 0
                                ts.consensus_claimed_by = None
                                ts.timer_seconds = 45
                                ts.last_activity_time = time.time()
                                
                                await manager.broadcast_to_team(session_code, team_number, "ROUND_CHANGED", {
                                    "round": 6,
                                    "topic": "Group Conclusion: Team Consensus",
                                    "speaking_time": 45
                                })
                                
                                conclusion_msg = (
                                    "🤖 AI Moderator: We are now entering Stage 6: Group Conclusion. "
                                    "What is the team consensus? Please discuss and decide. "
                                    "One participant can click 'Claim Consensus Speech' to deliver the final team consensus stance!"
                                )
                                await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                    "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": conclusion_msg
                                })
                            
                            await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())

                    elif ts.round == 6:
                        if ts.consensus_claimed_by == user_id:
                            transcript = payload.get("transcript", "").strip()
                            ts.consensus_text = transcript
                            
                            ts.transcripts[user_id] = (ts.transcripts.get(user_id, "") + " [Consensus Summary]: " + transcript).strip()
                            
                            # Transition to Stage 7: Final Evaluation
                            ts.round = 7
                            ts.all_finished = True
                            ts.timer_running = False
                            
                            await manager.broadcast_to_team(session_code, team_number, "ROUND_CHANGED", {
                                "round": 7,
                                "topic": ts.topic,
                                "speaking_time": 0
                            })
                            
                            moderator_msg = (
                                "🤖 AI Moderator: Thank you! The team consensus has been registered. "
                                "We are now in Stage 7: Final Evaluation. "
                                "I am running the final competency scores & awards calculations..."
                            )
                            await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                                "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": moderator_msg
                            })
                            
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
                                    
                                    # Fetch team topic mappings from DB
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

                                    if session_code not in manager._silence_tasks:
                                        manager._silence_tasks[session_code] = asyncio.create_task(silence_detector_task(session_code))

                                    for tn, ts in state.team_states.items():
                                        ts.start_discussion()
                                        ts.round = 2
                                        ts.timer_seconds = 10
                                        ts.timer_running = True
                                        
                                        moderator_msg = f"🤖 AI Moderator: Welcome to MZ ThinkCircle. Today's discussion topic is '{ts.topic}'. Let's begin the AI Introduction. Please review the rules. The Opening Round will begin in 10 seconds."
                                        asyncio.create_task(manager.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                                            "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": moderator_msg
                                        }))
                                        asyncio.create_task(manager.broadcast_to_team(session_code, tn, "TEAM_STATE_UPDATED", ts.snapshot()))
                                        
                                        async def auto_start_opening_round(session_code_local, tn_local, ts_local):
                                            await asyncio.sleep(10)
                                            if ts_local.round == 2:
                                                ts_local.speaking_order = list(ts_local.members.keys())
                                                random.shuffle(ts_local.speaking_order)
                                                ts_local.current_speaker_idx = 0
                                                ts_local.round = 3
                                                ts_local.timer_seconds = 600
                                                ts_local.timer_running = True
                                                import time
                                                ts_local.last_activity_time = time.time()
                                                
                                                first_speaker_id = ts_local.speaking_order[0]
                                                first_name = ts_local.members[first_speaker_id].get("name", "Student")
                                                
                                                await manager.broadcast_to_team(session_code_local, tn_local, "SPEAKER_CHANGED", {
                                                    "current_speaker_id": first_speaker_id,
                                                    "next_speaker_id": ts_local.speaking_order[1] if len(ts_local.speaking_order) > 1 else None,
                                                    "round": 3,
                                                    "topic": ts_local.topic,
                                                    "speaking_time": 600
                                                })
                                                opening_msg = f"🤖 AI Moderator: Let's begin Stage 3: Opening Round. {first_name}, you have up to 10 minutes. State your opinion. Click 'Conclude Turn' when you are done."
                                                await manager.broadcast_to_team(session_code_local, tn_local, "CHAT_MESSAGE", {
                                                    "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": opening_msg
                                                })
                                                await manager.broadcast_to_team(session_code_local, tn_local, "TEAM_STATE_UPDATED", ts_local.snapshot())

                                        asyncio.create_task(auto_start_opening_round(session_code, tn, ts))

                                    await manager.broadcast(session_code, "SESSION_STARTED", {"status": "active"})
                            except Exception as auto_err:
                                logger.error("Auto-start hosting failed: %s", auto_err)
                        elif not already_started:
                            # Teams were seeded in memory already; just kick off Stage 2.
                            try:
                                await _handle_admin_event(manager, state, session_code, "START_GD", {})
                            except Exception as auto_err:
                                logger.error("Auto-start (active) failed: %s", auto_err)

                continue

            elif event == "REQUEST_REBUTTAL":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    requested = bool(payload.get("requested", True))
                    if requested:
                        if sender_id not in ts.rebuttal_queue:
                            ts.rebuttal_queue.append(sender_id)
                    else:
                        if sender_id in ts.rebuttal_queue:
                            ts.rebuttal_queue.remove(sender_id)
                    await manager.broadcast_to_team(session_code, team_number, "REBUTTAL_REQUESTED", {
                        "user_id": sender_id,
                        "requested": requested
                    })
                    await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                continue

            elif event == "AGREE_DISAGREE_VOTE":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    speaker_id = payload.get("speaker_id")
                    vote_type = payload.get("vote_type")  # "agree" or "disagree"
                    if speaker_id:
                        ts.agree_disagree_votes.setdefault(speaker_id, {"agree": set(), "disagree": set()})
                        ts.agree_disagree_votes[speaker_id]["agree"].discard(sender_id)
                        ts.agree_disagree_votes[speaker_id]["disagree"].discard(sender_id)
                        ts.agree_disagree_votes[speaker_id][vote_type].add(sender_id)
                        await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                continue

            elif event == "CLAIM_CONSENSUS_TURN":
                ts = state.team_states.get(team_number) if team_number else None
                if ts and ts.round == 6:
                    ts.consensus_claimed_by = sender_id
                    ts.timer_seconds = 45
                    ts.timer_running = True
                    await manager.broadcast_to_team(session_code, team_number, "SPEAKER_CHANGED", {
                        "current_speaker_id": sender_id,
                        "next_speaker_id": None,
                        "round": 6,
                        "topic": ts.topic,
                        "speaking_time": 45
                    })
                    moderator_msg = f"🤖 AI Moderator: {name} has claimed the turn to explain the team consensus! You have 45 seconds."
                    await manager.broadcast_to_team(session_code, team_number, "CHAT_MESSAGE", {
                        "user_id": 0, "name": "AI Moderator", "label": "🤖 Moderator", "text": moderator_msg
                    })
                    await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
                continue

            elif event == "RAISE_HAND":
                p = state.participants.get(sender_id)
                if p is not None:
                    p["hand_raised"] = bool(payload.get("raised"))
                if team_number:
                    ts = state.team_states.get(team_number)
                    if ts:
                        raised = bool(payload.get("raised"))
                        if raised:
                            if sender_id not in ts.hand_raised_queue:
                                ts.hand_raised_queue.append(sender_id)
                        else:
                            if sender_id in ts.hand_raised_queue:
                                ts.hand_raised_queue.remove(sender_id)
                        await manager.broadcast_to_team(session_code, team_number, "TEAM_STATE_UPDATED", ts.snapshot())
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
        
        # Start silence detector task
        if session_code not in mgr._silence_tasks:
            mgr._silence_tasks[session_code] = asyncio.create_task(silence_detector_task(session_code))
        
        # Initialize speaking turns for each team
        for tn, ts in state.team_states.items():
            ts.start_discussion()
            # Set to Stage 2: AI Introduction
            ts.round = 2
            ts.timer_seconds = 10
            ts.timer_running = True
            
            # Welcome chat message
            moderator_msg = f"🤖 AI Moderator: Welcome to MZ ThinkCircle. Today's discussion topic is '{ts.topic}'. Let's begin the AI Introduction. Please review the rules. The Opening Round will begin in 10 seconds."
            asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                "user_id": 0,
                "name": "AI Moderator",
                "label": "🤖 Moderator",
                "text": moderator_msg
            }))
            
            asyncio.create_task(mgr.broadcast_to_team(session_code, tn, "TEAM_STATE_UPDATED", ts.snapshot()))
            
            # Background task to automatically transition to Stage 3: Opening Round
            async def auto_start_opening_round(session_code_local, tn_local, ts_local):
                await asyncio.sleep(10)
                if ts_local.round == 2:
                    ts_local.speaking_order = list(ts_local.members.keys())
                    random.shuffle(ts_local.speaking_order)
                    ts_local.current_speaker_idx = 0
                    ts_local.round = 3  # Stage 3: Opening Round
                    ts_local.timer_seconds = 600
                    ts_local.timer_running = True
                    import time
                    ts_local.last_activity_time = time.time()
                    
                    first_speaker_id = ts_local.speaking_order[0]
                    first_name = ts_local.members[first_speaker_id].get("name", "Student")
                    
                    await mgr.broadcast_to_team(session_code_local, tn_local, "SPEAKER_CHANGED", {
                        "current_speaker_id": first_speaker_id,
                        "next_speaker_id": ts_local.speaking_order[1] if len(ts_local.speaking_order) > 1 else None,
                        "round": 3,
                        "topic": ts_local.topic,
                        "speaking_time": 600
                    })
                    
                    opening_msg = f"🤖 AI Moderator: Let's begin Stage 3: Opening Round. {first_name}, you have up to 10 minutes. State your opinion. Click 'Conclude Turn' when you are done."
                    await mgr.broadcast_to_team(session_code_local, tn_local, "CHAT_MESSAGE", {
                        "user_id": 0,
                        "name": "AI Moderator",
                        "label": "🤖 Moderator",
                        "text": opening_msg
                    })
                    await mgr.broadcast_to_team(session_code_local, tn_local, "TEAM_STATE_UPDATED", ts_local.snapshot())
            
            asyncio.create_task(auto_start_opening_round(session_code, tn, ts))
            
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
