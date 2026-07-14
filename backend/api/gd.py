from fastapi import APIRouter, Depends, HTTPException, status
from mysql.connector import MySQLConnection

from backend.ai.evaluation import evaluate_transcript
from backend.database import queries
from backend.database.db import get_db
from backend.models.schemas import GDSessionCreate, GDTranscriptSubmit, GDLeaderboardEntry
from backend.security import get_current_user

router = APIRouter(prefix="/gd", tags=["Group Discussion"])


@router.get("/topics")
def list_topics(
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.list_gd_topics(connection)


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def create_gd(
    payload: GDSessionCreate,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session_id = queries.create_gd_session(connection, payload.topic_id, payload.team_size)
    queries.join_gd_session(connection, session_id, current_user["id"])
    return {"id": session_id, "message": "GD session created. Share the session ID with your team."}


@router.get("/sessions")
def list_gd_sessions(
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.list_gd_sessions(connection)


@router.get("/sessions/{session_id}")
def get_gd_session(
    session_id: int,
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    members = queries.get_gd_team_members(connection, session_id)
    session["members"] = members
    return session


@router.post("/sessions/{session_id}/join")
def join_gd(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session["status"] != "waiting":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GD already started")
    if queries.is_member_of_gd(connection, session_id, current_user["id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already joined")

    member_count = len(queries.get_gd_team_members(connection, session_id))
    if member_count >= session["team_size"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team is full")

    queries.join_gd_session(connection, session_id, current_user["id"])
    return {"message": "Joined GD session successfully"}


@router.post("/sessions/{session_id}/start")
def start_gd(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if not queries.is_member_of_gd(connection, session_id, current_user["id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this session")

    members = queries.get_gd_team_members(connection, session_id)
    if len(members) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Need at least 2 members to start")

    queries.update_gd_status(connection, session_id, "preparation")
    return {
        "message": "GD started! 4 minutes preparation time begins now.",
        "topic": session["topic"],
        "preparation_minutes": 4,
        "speaking_minutes": 16,
    }


@router.post("/sessions/{session_id}/submit")
def submit_transcript(
    session_id: int,
    payload: GDTranscriptSubmit,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session["status"] not in ("preparation", "speaking"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GD is not in progress")
    if not queries.is_member_of_gd(connection, session_id, current_user["id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this session")

    result = evaluate_transcript(payload.transcript)

    relevance_score = min(100, result.grammar_score * 0.3 + result.fluency_score * 0.3 + result.confidence_score * 0.4)
    content_quality = min(100, result.vocabulary_score * 0.5 + result.overall_score * 0.5)
    accent_score = result.pronunciation_score
    overall = round((result.grammar_score + result.fluency_score + accent_score + relevance_score + content_quality) / 5, 2)
    points = round(overall * 0.5, 2)

    queries.create_gd_evaluation(
        connection, session_id, current_user["id"],
        result.fluency_score, result.grammar_score, accent_score,
        relevance_score, content_quality, overall,
        payload.transcript, points,
    )
    return {
        "message": "Transcript evaluated",
        "overall_score": overall,
        "credential_points": points,
    }


@router.post("/sessions/{session_id}/finish")
def finish_gd(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    evaluations = queries.get_gd_evaluations(connection, session_id)
    if not evaluations:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No evaluations to rank")

    sorted_evals = sorted(evaluations, key=lambda x: x["overall_score"], reverse=True)
    for rank, ev in enumerate(sorted_evals, 1):
        queries.save_gd_leaderboard(connection, session_id, ev["user_id"], rank, ev["overall_score"], ev["credential_points"])
        queries.upsert_progress(connection, ev["user_id"], ev["overall_score"], 1, ev["credential_points"])

    queries.update_gd_status(connection, session_id, "completed")
    return {"message": "GD completed! Check the leaderboard.", "status": "completed"}


@router.get("/sessions/{session_id}/leaderboard")
def get_leaderboard(
    session_id: int,
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.get_gd_leaderboard(connection, session_id)
