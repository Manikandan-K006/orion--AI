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


@router.post("/topics/refresh")
def refresh_topic(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Get a fresh random topic (max 3 refreshes per user)."""
    result = queries.refresh_gd_topic(connection, current_user["id"])
    if "error" in result:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
    return result


@router.post("/topics/reset-refreshes")
def reset_refreshes(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Reset refresh count so user gets 3 fresh refreshes on next login."""
    queries.reset_topic_refreshes(connection, current_user["id"])
    return {"message": "Refresh count reset"}


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def create_gd(
    payload: GDSessionCreate,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session_code = queries.create_gd_session(connection, payload.topic_id, payload.team_size)
    queries.join_gd_session(connection, session_code, current_user["id"])
    queries.reset_topic_refreshes(connection, current_user["id"])
    return {"session_code": session_code, "message": "GD session created. Share the session code with your team."}


@router.get("/sessions")
def list_gd_sessions(
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.list_gd_sessions(connection)


@router.get("/sessions/{session_code}")
def get_gd_session(
    session_code: str,
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    members = queries.get_gd_team_members(connection, session_code)
    session["members"] = members
    return session


@router.post("/sessions/{session_code}/join")
def join_gd(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session["status"] != "waiting":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GD already started")
    if queries.is_member_of_gd(connection, session_code, current_user["id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already joined")

    member_count = len(queries.get_gd_team_members(connection, session_code))
    if member_count >= session["team_size"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team is full")

    queries.join_gd_session(connection, session_code, current_user["id"])
    return {"message": "Joined GD session successfully"}


@router.post("/sessions/{session_code}/invite")
def invite_to_gd(
    session_code: str,
    payload: dict,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Invite users to a GD session by their user IDs."""
    session = queries.get_gd_session(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session["status"] != "waiting":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GD already started")

    user_ids = payload.get("user_ids", [])
    if not user_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No users specified")

    member_count = len(queries.get_gd_team_members(connection, session_code))
    team_size = session["team_size"]

    invited = 0
    for uid in user_ids:
        if uid == current_user["id"]:
            continue
        if member_count + invited >= team_size:
            break
        if not queries.is_member_of_gd(connection, session_code, uid):
            queries.join_gd_session(connection, session_code, uid)
            invited += 1

    return {"message": f"Invited {invited} user(s) to the session", "invited_count": invited}


@router.post("/sessions/{session_code}/start")
def start_gd(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if not queries.is_member_of_gd(connection, session_code, current_user["id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this session")

    members = queries.get_gd_team_members(connection, session_code)
    if len(members) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Need at least 2 members to start")

    queries.update_gd_status(connection, session_code, "preparation")
    return {
        "message": "GD started! 4 minutes preparation time begins now.",
        "topic": session["topic"],
        "preparation_minutes": 4,
        "speaking_minutes": 16,
    }


@router.post("/sessions/{session_code}/submit")
def submit_transcript(
    session_code: str,
    payload: GDTranscriptSubmit,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if session["status"] not in ("preparation", "speaking"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GD is not in progress")
    if not queries.is_member_of_gd(connection, session_code, current_user["id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this session")

    result = evaluate_transcript(payload.transcript)

    relevance_score = min(100, result.grammar_score * 0.3 + result.fluency_score * 0.3 + result.confidence_score * 0.4)
    content_quality = min(100, result.vocabulary_score * 0.5 + result.overall_score * 0.5)
    accent_score = result.pronunciation_score
    overall = round((result.grammar_score + result.fluency_score + accent_score + relevance_score + content_quality) / 5, 2)
    points = round(overall * 0.5, 2)

    queries.create_gd_evaluation(
        connection, session_code, current_user["id"],
        result.fluency_score, result.grammar_score, accent_score,
        relevance_score, content_quality, overall,
        payload.transcript, points,
    )
    return {
        "message": "Transcript evaluated",
        "overall_score": overall,
        "credential_points": points,
    }


@router.post("/sessions/{session_code}/finish")
def finish_gd(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_gd_session(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    evaluations = queries.get_gd_evaluations(connection, session_code)
    if not evaluations:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No evaluations to rank")

    sorted_evals = sorted(evaluations, key=lambda x: x["overall_score"], reverse=True)
    for rank, ev in enumerate(sorted_evals, 1):
        queries.save_gd_leaderboard(connection, session_code, ev["user_id"], rank, ev["overall_score"], ev["credential_points"])
        queries.upsert_progress(connection, ev["user_id"], ev["overall_score"], 1, ev["credential_points"])

    queries.update_gd_status(connection, session_code, "completed")
    return {"message": "GD completed! Check the leaderboard.", "status": "completed"}


@router.get("/sessions/{session_code}/leaderboard")
def get_leaderboard(
    session_code: str,
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.get_gd_leaderboard(connection, session_code)
