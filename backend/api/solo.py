from fastapi import APIRouter, Depends, HTTPException, status
from mysql.connector import MySQLConnection

from backend.ai.evaluation import evaluate_transcript
from backend.database import queries
from backend.database.db import get_db
from backend.security import get_current_user

router = APIRouter(prefix="/solo", tags=["Solo Practice"])


@router.post("/start")
def start_solo(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    stats = queries.get_solo_stats(connection, current_user["id"])
    session_number = (stats.get("total_sessions") or 0) + 1

    topic = queries.fetch_one(connection,
        "SELECT topic FROM gd_topics ORDER BY RAND() LIMIT 1")
    if not topic:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No topics available")
    topic_text = topic["topic"]

    session_id = queries.create_solo_session(connection, current_user["id"], topic_text, session_number)
    queries.upsert_solo_usage(connection, current_user["id"])

    quote = queries.get_random_quote(connection, current_user["id"])

    last_session = queries.get_last_solo_session(connection, current_user["id"])

    return {
        "session_id": session_id,
        "topic": topic_text,
        "session_number": session_number,
        "preparation_minutes": 4,
        "speaking_minutes": 10,
        "quote": quote,
        "last_session": last_session,
        "is_new_user": stats.get("is_new", True),
    }


@router.post("/submit")
def submit_solo(
    payload: dict,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session_id = payload.get("session_id")
    transcript = payload.get("transcript", "")

    if not session_id or len(transcript) < 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID and transcript (min 10 chars) required")

    session = queries.get_solo_session(connection, session_id)
    if not session or session["user_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if session.get("status") == "completed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session already completed and evaluated")

    result = evaluate_transcript(transcript)

    delivery_score = min(100, result.confidence_score * 0.5 + result.pronunciation_score * 0.5)
    overall = round((result.grammar_score + result.fluency_score + result.pronunciation_score + delivery_score) / 4, 2)

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

    weakness_text = "; ".join(weaknesses)
    tips_text = "; ".join(tips)

    queries.complete_solo_session(connection, session_id, transcript, overall,
                                  result.fluency_score, result.grammar_score,
                                  result.pronunciation_score, delivery_score,
                                  weakness_text, tips_text)

    # 1. Fetch current profile progress
    progress_row = queries.get_progress(connection, current_user["id"])
    if progress_row:
        stored_avg = float(progress_row.get("average_score") or 0.0)
        stored_completed = int(progress_row.get("interviews_completed") or 0)
        new_count = stored_completed + 1
        new_avg = round(((stored_avg * stored_completed) + overall) / new_count, 2)
    else:
        new_count = 1
        new_avg = overall

    # 2. Add 5.0 credits on completion of a solo practice session
    queries.upsert_progress(connection, current_user["id"], average_score=new_avg, interviews_completed=new_count, total_credits=5.0)

    last_session = queries.get_last_solo_session(connection, current_user["id"])

    return {
        "message": "Solo practice evaluated!",
        "overall_score": overall,
        "fluency_score": result.fluency_score,
        "grammar_score": result.grammar_score,
        "accent_score": result.pronunciation_score,
        "delivery_score": delivery_score,
        "weaknesses": weaknesses,
        "improvement_tips": tips,
        "last_session": last_session,
    }


@router.get("/history")
def get_history(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.get_solo_history(connection, current_user["id"])


@router.get("/stats")
def get_stats(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    return queries.get_solo_stats(connection, current_user["id"])


@router.get("/quote")
def get_quote(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    quote = queries.get_random_quote(connection, current_user["id"])
    if not quote:
        return {"quote": "Keep going!", "author": "Unknown"}
    return quote
