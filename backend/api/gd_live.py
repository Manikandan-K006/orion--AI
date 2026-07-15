from fastapi import APIRouter, Depends, HTTPException, status
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import get_db
from backend.security import get_current_user

router = APIRouter(prefix="/gd-live", tags=["GD Live"])


@router.get("/easy-topics")
def list_easy_topics(
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.fetch_all(connection, "SELECT * FROM gd_easy_topics ORDER BY id")


@router.post("/sessions")
def create_live_session(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create sessions")
    result = queries.create_live_session(connection, current_user["id"])
    return result


@router.get("/sessions")
def list_live_sessions(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.list_live_sessions(connection)


@router.post("/sessions/{session_code}/join")
def join_live_session(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    result = queries.join_live_session(connection, session_code, current_user["id"])
    if result == "invalid":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found or not waiting")
    if result == "already_joined":
        return {"message": "You have already joined this session"}
    return {"message": "Joined session successfully"}


@router.post("/sessions/{session_code}/assign-teams")
def assign_live_teams(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can assign teams")
    teams = queries.assign_live_teams(connection, session_code)
    if not teams:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No participants to assign")
    return {"teams": teams, "message": f"Assigned {len(teams)} teams"}


@router.get("/sessions/{session_code}/my-team")
def get_my_team(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    team = queries.get_live_my_team(connection, session_code, current_user["id"])
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not assigned to any team yet")
    return team


@router.get("/sessions/{session_code}/participants")
def get_live_participants(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view participants")
    return queries.get_live_participants(connection, session_code)


@router.post("/sessions/{session_code}/start-team/{team_number}")
def start_live_team(
    session_code: str,
    team_number: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can start teams")
    success = queries.start_live_team(connection, session_code, team_number)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team not found or already active")
    return {"message": f"Team {team_number} started"}


@router.post("/sessions/{session_code}/submit-transcript")
def submit_live_transcript(
    session_code: str,
    payload: dict,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    transcript = payload.get("transcript", "")
    if not transcript or len(transcript) < 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript must be at least 10 characters")
    success = queries.submit_live_transcript(connection, session_code, current_user["id"], transcript)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not submit transcript")
    return {"message": "Transcript submitted"}


@router.post("/sessions/{session_code}/complete")
def complete_live_session(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can complete sessions")
    queries.complete_live_session(connection, session_code)
    return {"message": "Session completed"}
