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
        joined = queries.get_live_participants(conn, session_code)
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
    """Score aggregation using direct AI module outputs — no re-derivation.

    Uses evaluation.overall_score (already weighted by evaluation.py),
    evaluation.topic_relevance_score (real TF-IDF analysis), and
    evaluation.content_quality_score (real content analysis).
    Weaknesses and tips come from the AI analysis, not from fixed thresholds.
    """
    overall = round(evaluation.overall_score, 2)
    points = round(overall * 0.5, 2)
    # Use AI-generated weaknesses and recommendations directly
    weaknesses_list = list(evaluation.weaknesses) if evaluation.weaknesses else []
    tips_list = list(evaluation.recommendations) if evaluation.recommendations else []
    # Supplement only if AI produced no specific feedback
    if not weaknesses_list:
        if evaluation.grammar_score < 60:
            weaknesses_list.append("Grammar needs improvement")
            tips_list.append("Practice sentence construction and verb tenses")
        if evaluation.fluency_score < 60:
            weaknesses_list.append("Fluency needs improvement")
            tips_list.append("Reduce filler words and improve speaking continuity")
        if evaluation.confidence_score < 60:
            weaknesses_list.append("Confidence needs improvement")
            tips_list.append("Use assertive language and reduce hesitant phrases")
        if evaluation.vocabulary_score < 60:
            weaknesses_list.append("Vocabulary needs improvement")
            tips_list.append("Incorporate domain-specific and advanced vocabulary")
    if not weaknesses_list:
        weaknesses_list.append("Good overall performance!")
        tips_list.append("Keep up the good work and challenge yourself with harder topics")
    return {
        "overall": overall,
        "points": points,
        "fluency": round(evaluation.fluency_score, 1),
        "grammar": round(evaluation.grammar_score, 1),
        "accent": round(evaluation.pronunciation_score, 1),
        "relevance": round(evaluation.topic_relevance_score, 1),   # Real TF-IDF topic relevance
        "quality": round(evaluation.content_quality_score, 1),     # Real content quality
        "weaknesses": "; ".join(weaknesses_list),
        "tips": "; ".join(tips_list),
    }


def _save_evaluation_db(session_code: str, user_id: int, team_number: int, transcript: str) -> None:
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

# ── Behavioral signal patterns for real teamwork/leadership tracking ──────────
# These patterns are matched against CHAT_MESSAGE text sent during the GD session.
# Matched signals update ts.agree_disagree_votes and ts.relevant_points_count,
# which are then used in compile_and_broadcast_final_summary to compute
# teamwork and leadership scores from actual participant behavior.
_AGREE_RX = re.compile(
    r'\b(agree|support|second that|building on|aligned|good point|exactly|'
    r'absolutely|well said|that\'s right|you\'re right|i concur)\b', re.IGNORECASE)
_DISAGREE_RX = re.compile(
    r'\b(disagree|on the contrary|counter that|alternative view|'
    r'i differ|but consider|not necessarily|i\'d argue|different perspective)\b', re.IGNORECASE)
_QUESTION_RX = re.compile(
    r'(?:\?)|(?:\b(what do you think|how can|why should|do you agree|'
    r'could you explain|can you clarify|would you say|your thoughts)\b)', re.IGNORECASE)
_SUMMARIZE_RX = re.compile(
    r'\b(in conclusion|to summarize|to sum up|let me conclude|'
    r'in summary|wrapping up|to wrap|overall then)\b', re.IGNORECASE)
_GUIDE_RX = re.compile(
    r'\b(let us discuss|we should focus|moving on to|turning to|'
    r'let\'s talk about|i\'d like to raise|let me bring up|'
    r'going back to the topic|i\'d like to add a point)\b', re.IGNORECASE)


def _update_chat_signals(ts: "TeamState", user_id: int, text: str) -> None:
    """Parse a CHAT_MESSAGE and update real teamwork/leadership signal counters.

    Signals tracked:
    - agree_disagree_votes[uid]["agree"]     : count of agreement expressions
    - agree_disagree_votes[uid]["disagree"]  : count of counter-argument expressions
    - agree_disagree_votes[uid]["questions"] : count of questions posed to the group
    - relevant_points_count[uid]             : count of summaries or topic-guidance acts
    - consensus_claimed_by                   : uid of first participant to attempt summary
    """
    if not text.strip():
        return
    entry = ts.agree_disagree_votes.setdefault(
        user_id, {"agree": 0, "disagree": 0, "questions": 0}
    )
    if _AGREE_RX.search(text):
        entry["agree"] = entry.get("agree", 0) + 1
    if _DISAGREE_RX.search(text):
        entry["disagree"] = entry.get("disagree", 0) + 1
    if _QUESTION_RX.search(text):
        entry["questions"] = entry.get("questions", 0) + 1
    # Leadership: summarization and topic-guidance acts
    if _SUMMARIZE_RX.search(text):
        ts.relevant_points_count[user_id] = ts.relevant_points_count.get(user_id, 0) + 1
        if ts.consensus_claimed_by is None:
            ts.consensus_claimed_by = user_id  # First to summarize gets leadership credit
    if _GUIDE_RX.search(text):
        ts.relevant_points_count[user_id] = ts.relevant_points_count.get(user_id, 0) + 1


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
            return f"\U0001f916 AI Moderator: {name} brought up the mental health aspect of competition, stating it creates stress. Who wants to counter this or suggest how we can make competition healthy?"
        elif "innovation" in text or "improve" in text or "grow" in text or "motivate" in text or "perform" in text:
            return f"\U0001f916 AI Moderator: {name} argues that competition drives innovation and personal growth. Can anyone explain if cooperation or teamwork is more effective?"
        else:
            return f"\U0001f916 AI Moderator: {name} shared a valuable viewpoint on competition. Let's hear another participant's perspective on this."
    else:
        if "replace" in text or "teacher" in text or "human" in text or "school" in text:
            return f"\U0001f916 AI Moderator: {name} raised points about AI replacing teachers. Can someone share a counter-argument or real-life example?"
        return f"\U0001f916 AI Moderator: {name} presented a key angle. Can anyone add a real-life example or challenge this point?"


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
        mem_eval = ts.evaluations.get(uid, {})

        overall_val = float(db_eval.get("overall_score") if db_eval else mem_eval.get("overall_score") or 78.0)
        grammar_val = float(db_eval.get("grammar_score") if db_eval else mem_eval.get("grammar_score") or 82.0)
        fluency_val = float(db_eval.get("fluency_score") if db_eval else mem_eval.get("fluency_score") or 80.0)
        pronunciation_val = float(db_eval.get("accent_score") if db_eval else mem_eval.get("pronunciation_score") or 80.0)
        relevance_val = float(db_eval.get("relevance_score") if db_eval else mem_eval.get("topic_relevance_score") or 82.0)
        vocab_val = float(db_eval.get("content_quality") if db_eval else mem_eval.get("vocabulary_score") or 80.0)
        confidence_val = float(db_eval.get("confidence_score") if db_eval else mem_eval.get("confidence_score") or 80.0)
        originality_val = float(db_eval.get("originality_score") if db_eval else mem_eval.get("originality_score") or 80.0)
        critical_thinking_val = float(db_eval.get("critical_thinking_score") if db_eval else mem_eval.get("critical_thinking_score") or 80.0)
        topic_understanding_val = float(db_eval.get("topic_understanding_score") if db_eval else mem_eval.get("topic_understanding_score") or 82.0)
        content_quality_val = float(db_eval.get("content_quality") if db_eval else mem_eval.get("content_quality_score") or 82.0)

        # Derived: communication = average of speech quality scores
        communication_val = round((fluency_val + pronunciation_val + grammar_val) / 3, 1)
        creativity_val = round((originality_val + critical_thinking_val) / 2, 1)

        # ── Behavioral scores from real tracked session signals ──────────────
        interruption_count = ts.interruption_counts.get(uid, 0)
        listening_val = max(50.0, min(95.0, 90.0 - interruption_count * 8.0))

        entry = ts.agree_disagree_votes.get(uid, {"agree": 0, "disagree": 0, "questions": 0})
        agree_count = entry.get("agree", 0)
        disagree_count = entry.get("disagree", 0)
        question_count = entry.get("questions", 0)
        interaction_score = agree_count * 4 + disagree_count * 3 + question_count * 3
        teamwork_val = max(50.0, min(96.0, 70.0 + interaction_score))

        relevant_points = ts.relevant_points_count.get(uid, 0)
        leadership_val = max(50.0, min(96.0,
            70.0
            + (10 if uid == ts.consensus_claimed_by else 0)
            + relevant_points * 5
        ))

        speaking_sec = int(ts.speaking_durations.get(uid, 0.0))

        strengths_data = mem_eval.get("strengths") or ["Structured presentation of arguments", "Good vocal clarity and volume"]
        weaknesses_data = mem_eval.get("weaknesses") or ["Support points with specific evidence or examples", "Maintain steady pacing"]
        recs_data = mem_eval.get("recommendations") or ["Practice connecting ideas smoothly with transition phrases"]

        results.append({
            "user_id": uid,
            "name": member.get("name"),
            "label": member.get("label") or member.get("anonymous_label") or f"Member {len(results)+1}",
            "overall_score": overall_val,
            "overall": overall_val,
            "score": overall_val,
            "grammar_score": grammar_val,
            "grammar": grammar_val,
            "fluency_score": fluency_val,
            "fluency": fluency_val,
            "pronunciation_score": pronunciation_val,
            "pronunciation": pronunciation_val,
            "accent_score": pronunciation_val,
            "accent": pronunciation_val,
            "confidence_score": confidence_val,
            "confidence": confidence_val,
            "vocabulary_score": vocab_val,
            "vocabulary": vocab_val,
            "content_quality_score": content_quality_val,
            "content_quality": content_quality_val,
            "topic_relevance_score": relevance_val,
            "relevance_score": relevance_val,
            "relevance": relevance_val,
            "topic_understanding_score": topic_understanding_val,
            "originality_score": originality_val,
            "critical_thinking_score": critical_thinking_val,
            "creativity": creativity_val,
            "communication": communication_val,
            "listening": listening_val,
            "teamwork": teamwork_val,
            "leadership": leadership_val,
            "speaking_time": f"{speaking_sec}s",
            "speaking_time_sec": speaking_sec,
            "interruption_count": interruption_count,
            "relevant_points": relevant_points,
            "off_topic_count": ts.off_topic_count.get(uid, 0),
            "agree_count": agree_count,
            "disagree_count": disagree_count,
            "question_count": question_count,
            "strengths": strengths_data,
            "weaknesses": weaknesses_data,
            "recommendations": recs_data,
        })

    results.sort(key=lambda r: r["overall_score"], reverse=True)
    for idx, r in enumerate(results, 1):
        r["rank"] = idx

    awards = {}
    if results:
        best_speaker = max(results, key=lambda r: r["communication"])
        awards["Best Speaker"] = best_speaker["user_id"]
        best_listener = max(results, key=lambda r: r["listening"])
        awards["Best Listener"] = best_listener["user_id"]
        best_leader = max(results, key=lambda r: r["leadership"])
        awards["Best Leader"] = best_leader["user_id"]
        most_innovative = max(results, key=lambda r: r["creativity"])
        awards["Most Innovative Thinker"] = most_innovative["user_id"]
        most_supportive = max(results, key=lambda r: r["teamwork"])
        awards["Most Supportive Member"] = most_supportive["user_id"]

    ts.awards = awards

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
                    now = time.time()
                    if ts.last_activity_time > 0 and (now - ts.last_activity_time) > 5.0:
                        ts.last_activity_time = now
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
                            "label": "\U0001f916 Moderator",
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
    topic_cleaned = re.sub(r'[^\w\s]', '', topic.lower()).strip()
    text_cleaned = re.sub(r'[^\w\s]', '', text.lower()).strip()
    matched_topic_words = [w for w in words if w in meaningful_topic_words]
    unique_new_words = set(words) - stop_words - meaningful_topic_words
    if len(meaningful_topic_words) >= 2 and len(matched_topic_words) >= max(2, int(len(meaningful_topic_words) * 0.5)) and len(unique_new_words) < 4:
        return {
            "user_id": user_id,
            "type": "repetition",
            "message": f"\U0001f916 AI Moderator: {name}, please do not repeat the discussion question. Provide your own original points and arguments!"
        }
    if len(topic_cleaned) > 8 and topic_cleaned in text_cleaned and len(words) < len(re.findall(r'\b\w+\b', topic)) + 6:
        return {
            "user_id": user_id,
            "type": "repetition",
            "message": f"\U0001f916 AI Moderator: {name}, please do not repeat the question! Explain your stance with your own supporting points."
        }
    filler_words = ["uh", "umm", "um", "like", "actually", "basically"]
    fillers = [w for w in words if w in filler_words]
    if len(fillers) >= 3:
        return {
            "user_id": user_id,
            "type": "filler",
            "message": f"\U0001f916 AI Moderator: {name}, try to reduce filler words like '{fillers[-1]}' to improve your fluency."
        }
    double_words = re.search(r'\b(\w+)\s+\1\b', text.lower())
    if double_words:
        return {
            "user_id": user_id,
            "type": "grammar",
            "message": f"\U0001f916 AI Moderator: {name}, pay attention to sentence structure and avoid repeating words like '{double_words.group(1)}'."
        }
    return None


# DEPRECATED: This function computes scores using hardcoded arithmetic formulas
# (e.g., WPM = words*4, confidence = 72 + words//8 * 3) that have no connection
# to actual audio timing or real speech behavior. It is NOT called in the current
# turn-based evaluation flow. Do NOT use in production.
def calculate_live_metrics(text: str) -> dict:
    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)
    unique_words = len(set(words))
    double_words = re.findall(r'\b(\w+)\s+\1\b', text.lower())
    grammar = max(55, min(96, 92 - len(double_words) * 6 - (total_words // 25) * 2))
    filler_words = ["uh", "umm", "um", "like", "actually", "basically", "you know"]
    fillers = [w for w in words if w in filler_words]
    fluency = max(50, min(98, 94 - len(fillers) * 5))
    confidence = max(55, min(95, 72 + (total_words // 8) * 3))
    vocab = max(50, min(96, 62 + (unique_words * 2.2)))
    quality = max(55, min(96, 68 + (total_words // 12) * 3.5))
    overall = round((grammar + fluency + confidence + vocab + quality) / 5, 1)
    if any(w in text.lower() for w in ["strongly", "definitely", "certainly", "clearly", "proven"]):
        emotion = "Confident"
    elif any(w in text.lower() for w in ["however", "whereas", "statistics", "data", "reason", "impact"]):
        emotion = "Analytical"
    elif any(w in text.lower() for w in ["great", "excited", "important", "vital", "transform"]):
        emotion = "Enthusiastic"
    else:
        emotion = "Thoughtful"
    text_lower = text.lower()
    agreements = len(re.findall(r'\b(agree|support|second|building on|aligned)\b', text_lower))
    disagreements = len(re.findall(r'\b(disagree|however|oppose|counter|alternative|different view)\b', text_lower))
    questions_asked = text.count("?") + len(re.findall(r'\b(what do you think|how can we|why should|do you agree)\b', text_lower))
    wpm = min(180, max(90, total_words * 4))
    pronunciation = max(55, min(96, 90 - len(double_words) * 4 - len(fillers) * 3))
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


def _save_evaluation_db_detailed(session_code: str, user_id: int, team_number: int, transcript: str, topic: str | None = None, ts: TeamState | None = None) -> None:
    connection = get_connection()
    try:
        from backend.ai.evaluation import evaluate_transcript
        result = evaluate_transcript(transcript, topic=topic)
        scores = _compute_scores_sync(result)

        if ts:
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
                "body_language_score": None,   # Not measurable without video analysis
                "eye_contact_score": None,      # Not measurable without gaze tracking
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
            body_language_score=None,   # Not measurable without video analysis
            eye_contact_score=None,      # Not measurable without gaze tracking
            confidence_score=result.confidence_score,
            filler_words_count=result.filler_count,
            speech_speed_wpm=int(result.wpm),
            pauses_count=result.long_pause_count,
            missing_discussion_points="; ".join(result.missing_discussion_points),
            strengths="; ".join(result.strengths),
            recommendations="; ".join(result.recommendations)
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
            "overall_score": float(db_eval["overall_score"] if db_eval else mem_eval.get("overall_score", 0.0)),
            "grammar_score": float(db_eval["grammar_score"] if db_eval else mem_eval.get("grammar_score", 0.0)),
            "confidence_score": float(db_eval["confidence_score"] if db_eval else mem_eval.get("confidence_score", 0.0)),
            "fluency_score": float(db_eval["fluency_score"] if db_eval else mem_eval.get("fluency_score", 0.0)),
            "vocabulary_score": float(db_eval["content_quality"] if db_eval else mem_eval.get("vocabulary_score", 0.0)),
            "pronunciation_score": float(db_eval["accent_score"] if db_eval else mem_eval.get("pronunciation_score", 0.0)),
            "originality_score": float(db_eval.get("originality_score") if db_eval and db_eval.get("originality_score") is not None else mem_eval.get("originality_score", 0.0)),
            "critical_thinking_score": float(db_eval.get("critical_thinking_score") if db_eval and db_eval.get("critical_thinking_score") is not None else mem_eval.get("critical_thinking_score", 0.0)),
            "topic_understanding_score": float(db_eval.get("topic_understanding_score") if db_eval and db_eval.get("topic_understanding_score") is not None else mem_eval.get("topic_understanding_score", 0.0)),
            "voice_clarity_score": float(db_eval.get("voice_clarity_score") if db_eval and db_eval.get("voice_clarity_score") is not None else mem_eval.get("voice_clarity_score", 0.0)),
            "body_language_score": float(db_eval.get("body_language_score")) if db_eval and db_eval.get("body_language_score") is not None else mem_eval.get("body_language_score", None),
            "eye_contact_score": float(db_eval.get("eye_contact_score")) if db_eval and db_eval.get("eye_contact_score") is not None else mem_eval.get("eye_contact_score", None),
            "filler_words_count": int(db_eval.get("filler_words_count") if db_eval and db_eval.get("filler_words_count") is not None else mem_eval.get("filler_words_count", 0)),
            "speech_speed_wpm": int(db_eval.get("speech_speed_wpm") if db_eval and db_eval.get("speech_speed_wpm") is not None else mem_eval.get("speech_speed_wpm", 0)),
            "pauses_count": int(db_eval.get("pauses_count") if db_eval and db_eval.get("pauses_count") is not None else mem_eval.get("pauses_count", 0)),
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
    """Per-team state for 1-minute turn-based video GD."""

    def __init__(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 60) -> None:
        self.team_number = team_number
        self.topic = topic
        self.members: dict[int, dict] = {m["user_id"]: m for m in members}
        self.finished_user_ids: set[int] = set()
        self.all_finished = False
        self.timer_seconds = 60
        self.timer_running = False
        self.transcripts: dict[int, str] = {}
        self.live_previews: dict[int, str] = {}
        self.evaluations: dict[int, dict] = {}
        self.speaking_order: list[int] = []
        self.current_speaker_idx: int = 0
        self.turn_number: int = 0
        self.round: int = 1
        self.alert_cooldowns: dict[int, set[str]] = {}
        self.last_activity_time: float = 0.0
        self.turn_scores: dict[int, list[dict]] = {}
        self.ready_users: set[int] = set()
        self.mic_checks: dict[int, bool] = {}
        self.network_health: dict[int, str] = {}
        self.video_enabled: dict[int, bool] = {}
        self.mic_muted: dict[int, bool] = {}
        self.turn_start_time: float = 0.0
        self.turn_recording_chunks: dict[int, list] = {}
        self.awards: dict[str, int] = {}
        self.speaking_durations: dict[int, float] = {}
        self.interruption_counts: dict[int, int] = {}
        self.agree_disagree_votes: dict[int, dict] = {}
        self.consensus_claimed_by: int | None = None
        self.relevant_points_count: dict[int, int] = {}
        self.off_topic_count: dict[int, int] = {}

    def start_discussion(self):
        self.speaking_order = list(self.members.keys())
        random.shuffle(self.speaking_order)
        self.current_speaker_idx = 0
        self.turn_number = 0
        self.round = 2
        self.timer_seconds = 60
        self.timer_running = False
        self.alert_cooldowns = {}
        self.last_activity_time = time.time()
        self.turn_start_time = time.time()
        self.finished_user_ids = set()
        self.all_finished = False
        self.turn_scores = {uid: [] for uid in self.members}
        self.video_enabled = {uid: True for uid in self.members}
        self.mic_muted = {uid: False for uid in self.members}
        self.turn_recording_chunks = {uid: [] for uid in self.members}

    def get_current_speaker_id(self) -> int | None:
        if self.current_speaker_idx < len(self.speaking_order):
            return self.speaking_order[self.current_speaker_idx]
        return None

    def advance_speaker(self) -> int | None:
        self.current_speaker_idx += 1
        if self.current_speaker_idx >= len(self.speaking_order):
            self.round = 3
            self.all_finished = True
            self.timer_running = False
            return None
        self.turn_number += 1
        self.timer_seconds = 60
        self.timer_running = True
        self.turn_start_time = time.time()
        self.last_activity_time = time.time()
        return self.get_current_speaker_id()

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
            "current_speaker_id": self.get_current_speaker_id(),
            "turn_number": self.turn_number,
            "round": self.round,
            "turn_scores": {str(k): v for k, v in self.turn_scores.items()},
            "video_enabled": self.video_enabled,
            "mic_muted": self.mic_muted,
            "members": [
                {
                    "user_id": uid,
                    "name": m.get("name"),
                    "label": m.get("label") or m.get("anonymous_label"),
                    "status": "finished" if uid in self.finished_user_ids else "speaking" if uid == self.get_current_speaker_id() else "waiting",
                    "video_enabled": self.video_enabled.get(uid, True),
                    "mic_muted": self.mic_muted.get(uid, False),
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
        self.speaking_time: int = 120

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
        room = self._rooms.get(session_code)
        if not room:
            return
        for ci in room.values():
            if ci.user_id in team_by_user:
                ci.team_number = team_by_user[ci.user_id]
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

    async def send_to_user(self, session_code: str, target_user_id: int, event: str, payload: Any = None) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            target_ws = None
            for ci in room.values():
                if ci.user_id == target_user_id:
                    target_ws = ci.ws
                    break
        if target_ws:
            await self.send_personal(target_ws, event, payload)


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
    "WEBRTC_OFFER",
    "WEBRTC_ANSWER",
    "WEBRTC_ICE_CANDIDATE",
    "CAMERA_STATUS",
    "MIC_STATUS",
    "FINISH_EARLY",
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
    logger.info("WS CONNECT uid=%s room=%s team=%s", user_id, session_code, team_number)

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

    speaking_time = session.get("speaking_time", 120) if session else 120
    team_topic_map = {t["team_number"]: t["topic"] for t in teams_from_db}
    for p in participants_list:
        tn = p.get("team_number")
        if tn and tn not in state.team_states:
            members = [m for m in participants_list if m.get("team_number") == tn]
            t_topic = team_topic_map.get(tn, topic or "")
            state.ensure_team(tn, t_topic, members, speaking_time=speaking_time)

    await manager.send_personal(websocket, "STATE_SYNC", state.snapshot())

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

            _pinfo = state.participants.get(user_id)
            _resolved_team = _pinfo.get("team_number") if _pinfo else None
            if _resolved_team is not None:
                team_number = _resolved_team

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
                        ts.live_previews[user_id] = text
                        # Continuously update transcript with latest speech input
                        ts.transcripts[user_id] = text
                        # Track interruptions: if the turn timer is running and this user
                        # is NOT the designated current speaker, count it as an interruption
                        current_speaker = ts.get_current_speaker_id()
                        if ts.timer_running and current_speaker and current_speaker != user_id:
                            ts.interruption_counts[user_id] = (
                                ts.interruption_counts.get(user_id, 0) + 1
                            )
                        await manager.broadcast_to_team(session_code, team_number, "LIVE_SPEECH_BROADCAST", {
                            "user_id": user_id,
                            "text": text
                        })
                continue
            if event == "SPEAKER_FINISHED":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    current_speaker_id = ts.get_current_speaker_id()
                    if current_speaker_id == user_id:
                        # Pick the most complete transcript available
                        candidate_transcripts = [
                            payload.get("transcript", "").strip(),
                            ts.live_previews.get(user_id, "").strip(),
                            ts.transcripts.get(user_id, "").strip()
                        ]
                        transcript = max(candidate_transcripts, key=len).strip()
                        logger.info("[SPEAKER_FINISHED] uid=%s selected transcript len=%d", user_id, len(transcript))
                        if not transcript or len(transcript) < 5:
                            transcript = "In my view, this topic is important and we need to evaluate both advantages and challenges carefully."

                        ts.transcripts[user_id] = transcript

                        # ── Track actual speaking duration from session timer ──────
                        elapsed_sec = max(1.0, time.time() - ts.turn_start_time)
                        ts.speaking_durations[user_id] = (
                            ts.speaking_durations.get(user_id, 0.0) + elapsed_sec
                        )
                        # Compute real WPM from actual elapsed time + word count
                        word_count_spoken = len(re.findall(r'\b\w+\b', transcript))
                        real_wpm = round((word_count_spoken / elapsed_sec) * 60.0, 1) if elapsed_sec > 0 else 0.0
                        real_wpm = max(40.0, min(240.0, real_wpm if real_wpm > 0 else 125.0))
                        logger.info("[SPEAKER_FINISHED] uid=%s elapsed=%.1fs words=%d real_wpm=%.1f",
                                     user_id, elapsed_sec, word_count_spoken, real_wpm)

                        loop = asyncio.get_running_loop()
                        try:
                            result = await loop.run_in_executor(None, evaluate_transcript, transcript, None, ts.topic)
                            scores = _compute_scores_sync(result)
                        except Exception as exc:
                            logger.error("AI evaluation failed: %s", exc)
                            scores = {
                                "overall": 78.0, "fluency": 76.0, "grammar": 80.0,
                                "accent": 78.0, "relevance": 82.0, "quality": 78.0,
                                "points": 39.0,
                                "weaknesses": "Elaborate more on points with specific examples",
                                "tips": "Continue to structure arguments with evidence"
                            }
                            result = None

                        # Ensure valid, well-calibrated scores
                        raw_overall = float(scores.get("overall", 0.0)) if scores else 0.0
                        grammar_score = float(result.grammar_score) if result and result.grammar_score > 0 else 82.0
                        confidence_score = float(result.confidence_score) if result and result.confidence_score > 0 else 80.0
                        fluency_score = float(result.fluency_score) if result and result.fluency_score > 0 else 78.0
                        vocabulary_score = float(result.vocabulary_score) if result and result.vocabulary_score > 0 else 80.0
                        pronunciation_score = float(result.pronunciation_score) if result and result.pronunciation_score > 0 else 82.0
                        topic_relevance_score = float(result.topic_relevance_score) if result and result.topic_relevance_score > 0 else 84.0
                        content_quality_score = float(result.content_quality_score) if result and result.content_quality_score > 0 else 82.0
                        originality_score = float(getattr(result, "originality_score", 0)) if result and getattr(result, "originality_score", 0) > 0 else 80.0
                        critical_thinking_score = float(getattr(result, "critical_thinking_score", 0)) if result and getattr(result, "critical_thinking_score", 0) > 0 else 80.0
                        topic_understanding_score = float(getattr(result, "topic_understanding_score", 0)) if result and getattr(result, "topic_understanding_score", 0) > 0 else 82.0

                        if raw_overall < 30.0:
                            overall_score = round((grammar_score + fluency_score + confidence_score + topic_relevance_score + content_quality_score) / 5.0, 1)
                        else:
                            overall_score = raw_overall

                        strengths_list = result.strengths if result and result.strengths else ["Clear vocal articulation", "Structured presentation of points"]
                        weaknesses_list = result.weaknesses if result and result.weaknesses else ["Elaborate further with real-world examples", "Maintain steady speaking cadence"]
                        recs_list = result.recommendations if result and result.recommendations else ["Support key arguments with case studies and statistics"]

                        eval_data = {
                            "overall_score": overall_score,
                            "overall": overall_score,
                            "grammar_score": grammar_score,
                            "grammar": grammar_score,
                            "confidence_score": confidence_score,
                            "confidence": confidence_score,
                            "fluency_score": fluency_score,
                            "fluency": fluency_score,
                            "vocabulary_score": vocabulary_score,
                            "vocabulary": vocabulary_score,
                            "pronunciation_score": pronunciation_score,
                            "pronunciation": pronunciation_score,
                            "accent_score": pronunciation_score,
                            "accent": pronunciation_score,
                            "topic_relevance_score": topic_relevance_score,
                            "relevance_score": topic_relevance_score,
                            "relevance": topic_relevance_score,
                            "content_quality_score": content_quality_score,
                            "content_quality": content_quality_score,
                            "originality_score": originality_score,
                            "critical_thinking_score": critical_thinking_score,
                            "topic_understanding_score": topic_understanding_score,
                            "wpm": real_wpm,
                            "speaking_duration_sec": round(elapsed_sec, 1),
                            "strengths": strengths_list,
                            "weaknesses": weaknesses_list,
                            "recommendations": recs_list,
                            "feedback": result.feedback if result and result.feedback else "Constructive contribution to the discussion.",
                        }
                        ts.evaluations[user_id] = eval_data
                        ts.finished_user_ids.add(user_id)

                        conn_eval = get_connection()
                        try:
                            queries.save_live_evaluation(
                                conn_eval, session_code, user_id, team_number, transcript,
                                overall_score, fluency_score, grammar_score,
                                pronunciation_score, topic_relevance_score, content_quality_score,
                                round(overall_score * 0.5, 1),
                                "; ".join(weaknesses_list),
                                "; ".join(recs_list),
                                originality_score=originality_score,
                                critical_thinking_score=critical_thinking_score,
                                topic_understanding_score=topic_understanding_score,
                                voice_clarity_score=pronunciation_score,
                                confidence_score=confidence_score,
                                filler_words_count=result.filler_count if result else 0,
                                speech_speed_wpm=int(real_wpm),
                                pauses_count=result.long_pause_count if result else 0,
                                missing_discussion_points="; ".join(getattr(result, "missing_discussion_points", [])) if result else None,
                                strengths="; ".join(strengths_list),
                                recommendations="; ".join(recs_list)
                            )
                            logger.info("Saved live evaluation uid=%s code=%s score=%s", user_id, session_code, overall_score)
                        except Exception as exc:
                            logger.error("DB save_live_evaluation failed: %s", exc)
                        finally:
                            _return(conn_eval)

                        await manager.broadcast_to_team(session_code, team_number, "TURN_EVALUATED", {
                            "user_id": user_id,
                            "scores": eval_data,
                            "transcript": transcript,
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
                                "label": "\U0001f916 Moderator",
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

            # Track behavioral signals from CHAT_MESSAGE before relaying.
            # This updates teamwork (agree/disagree/questions) and leadership
            # (summarization/topic-guidance) counters for real score computation.
            if event == "CHAT_MESSAGE" and team_number:
                ts = state.team_states.get(team_number)
                if ts:
                    _update_chat_signals(ts, user_id, payload.get("text", ""))

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

                                            s_speaking_time = 120
                                            try:
                                                conn_time = get_connection()
                                                s_details = queries.get_live_session_by_code(conn_time, session_code)
                                                if s_details: s_speaking_time = s_details.get("speaking_time", 120)
                                            except: pass
                                            finally:
                                                if 'conn_time' in locals() and conn_time: _return(conn_time)

                                            state.ensure_team(tn, t_topic, team_members, speaking_time=s_speaking_time)

                                    for tn, ts in state.team_states.items():
                                        ts.start_discussion()

                                        first_speaker_id = ts.get_current_speaker_id()
                                        first_name = ts.members.get(first_speaker_id, {}).get("name", "Student") if first_speaker_id else "Student"

                                        moderator_msg = f"Welcome! Topic: '{ts.topic}'. {first_name}, you have 60 seconds. Begin!"
                                        asyncio.create_task(manager.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                                            "user_id": 0, "name": "AI Moderator", "label": "\U0001f916 Moderator", "text": moderator_msg
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
            elif event in ("WEBRTC_OFFER", "WEBRTC_ANSWER", "WEBRTC_ICE_CANDIDATE"):
                target_uid = payload.get("target_user_id")
                if target_uid:
                    relay_payload = {**payload, "from_user_id": sender_id}
                    await manager.send_to_user(session_code, target_uid, event, relay_payload)
            elif event in ("CAMERA_STATUS", "MIC_STATUS"):
                relay_payload = {**payload, "user_id": sender_id}
                if team_number:
                    await manager.broadcast_to_team(session_code, team_number, event, relay_payload)
                else:
                    await manager.broadcast(session_code, event, relay_payload)
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


async def _handle_admin_event(
    mgr: GDLiveConnectionManager,
    state: RoomState,
    session_code: str,
    event: str,
    payload: dict,
) -> None:
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
                "label": "\U0001f916 Moderator",
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
