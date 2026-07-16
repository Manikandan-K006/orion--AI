from fastapi import APIRouter, Depends, HTTPException, status
from mysql.connector import MySQLConnection

from backend.ai.evaluation import evaluate_transcript
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


@router.delete("/sessions/{session_code}")
def delete_live_session(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete sessions")
    queries.delete_live_session(connection, session_code)
    return {"message": "Session deleted"}


@router.get("/sessions/{session_code}/my-team-status")
def get_my_team_status(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Check team status: how many members have submitted, and if all done."""
    participant = queries.fetch_one(connection,
        "SELECT team_number, status FROM gd_live_participants WHERE session_code = %s AND user_id = %s",
        (session_code, current_user["id"]))
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a participant")
    if not participant["team_number"]:
        return {"team_number": None, "status": participant["status"], "members_done": 0, "members_total": 0}

    members = queries.get_live_team_participants(connection, session_code, participant["team_number"])
    done = sum(1 for m in members if m["status"] == "completed")
    all_done = queries.check_team_all_completed(connection, session_code, participant["team_number"])

    return {
        "team_number": participant["team_number"],
        "my_status": participant["status"],
        "members_total": len(members),
        "members_done": done,
        "all_completed": all_done,
    }


@router.post("/sessions/{session_code}/submit-and-evaluate")
def submit_and_evaluate_live(
    session_code: str,
    payload: dict,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Submit transcript, then auto-evaluate self + entire team if all members done."""
    transcript = payload.get("transcript", "")
    if not transcript or len(transcript) < 10:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript must be at least 10 characters")

    # Find participant
    participant = queries.fetch_one(connection,
        "SELECT id, team_number FROM gd_live_participants WHERE session_code = %s AND user_id = %s",
        (session_code, current_user["id"]))
    if not participant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a participant")
    if not participant["team_number"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not assigned to a team yet")

    # Save transcript
    queries.submit_live_transcript(connection, session_code, current_user["id"], transcript)

    # Evaluate self
    _evaluate_live_participant(connection, session_code, current_user["id"],
                               participant["team_number"], transcript)

    # Check if all team members completed
    team_number = participant["team_number"]
    all_done = queries.check_team_all_completed(connection, session_code, team_number)

    # Mark team completed if all done
    if all_done:
        queries.execute(connection,
            "UPDATE gd_live_teams SET status = 'completed' WHERE session_code = %s AND team_number = %s",
            (session_code, team_number))

    # Get own evaluation
    evaluation = queries.get_live_evaluation_for_user(connection, session_code, current_user["id"])

    return {
        "message": "Transcript submitted and evaluated",
        "all_completed": all_done,
        "evaluation": evaluation,
    }


def _evaluate_live_participant(
    connection: MySQLConnection, session_code: str, user_id: int, team_number: int, transcript: str
) -> None:
    from backend.ai.evaluation import evaluate_transcript
    result = evaluate_transcript(transcript)

    relevance_score = min(100, result.grammar_score * 0.3 + result.fluency_score * 0.3 + result.confidence_score * 0.4)
    content_quality = min(100, result.vocabulary_score * 0.5 + result.overall_score * 0.5)
    accent_score = result.pronunciation_score
    overall = round((result.grammar_score + result.fluency_score + accent_score + relevance_score + content_quality) / 5, 2)
    points = round(overall * 0.5, 2)

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

    queries.save_live_evaluation(
        connection, session_code, user_id, team_number, transcript,
        overall, result.fluency_score, result.grammar_score,
        accent_score, relevance_score, content_quality, points,
        "; ".join(weaknesses), "; ".join(tips),
    )


@router.get("/sessions/{session_code}/my-result")
def get_my_live_result(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    result = queries.get_live_evaluation_for_user(connection, session_code, current_user["id"])
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No evaluation found")
    return result


@router.get("/sessions/{session_code}/leaderboard")
def get_live_leaderboard(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view leaderboard")
    results = queries.get_live_leaderboard(connection, session_code)
    if not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No evaluations yet")
    return results


@router.get("/sessions/{session_code}/my-team/topic")
def get_my_team_topic(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    participant = queries.fetch_one(connection,
        "SELECT team_number FROM gd_live_participants WHERE session_code = %s AND user_id = %s",
        (session_code, current_user["id"]))
    if not participant or not participant["team_number"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not assigned to a team")
    team = queries.fetch_one(connection,
        "SELECT topic, status FROM gd_live_teams WHERE session_code = %s AND team_number = %s",
        (session_code, participant["team_number"]))
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return {"team_number": participant["team_number"], "topic": team["topic"], "status": team["status"]}
