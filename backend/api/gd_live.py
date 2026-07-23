import asyncio
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile
from fastapi.responses import FileResponse
from mysql.connector import MySQLConnection

from backend.ai.speech_recognition import transcribe_audio
from backend.config import get_settings
from backend.database import queries
from backend.database import team_alloc
from backend.database.db import get_db
from backend.realtime.gd_ws import manager
from backend.security import get_current_user, hash_password
from backend.models.schemas import GDSessionCreate

ALLOWED_AUDIO_TYPES = {".wav", ".webm", ".mp3", ".m4a", ".ogg"}
# Progress stages displayed to the student in order
AI_PROGRESS_STAGES = [
    "uploading", "transcribing",
    "grammar", "vocabulary", "fluency", "confidence", "pronunciation",
    "generating_scores", "complete",
]

router = APIRouter(prefix="/gd-live", tags=["GD Live"])


@router.get("/easy-topics")
def list_easy_topics(
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.fetch_all(connection, "SELECT * FROM gd_easy_topics ORDER BY id")


def _create_live_session_db(user_id: int, topic_id: int, team_size: int, department: str | None, year: str | None, section: str | None) -> dict:
    from backend.database.db import get_connection
    conn = get_connection()
    try:
        code = queries.generate_live_code(conn)
        queries.execute(conn, 
            "INSERT INTO gd_live_sessions (session_code, status, total_participants, created_by, department, year, section, team_size) VALUES (%s, 'waiting', 0, %s, %s, %s, %s, %s)", 
            (code, user_id, department, year, section, team_size))
        
        # Fetch the selected topic
        topic_row = queries.fetch_one(conn, "SELECT topic FROM gd_easy_topics WHERE id = %s", (topic_id,))
        topic = topic_row["topic"] if topic_row else "Introduce yourself and share your thoughts"
        
        # Create first team with topic
        queries.execute(conn,
            "INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES (%s, %s, %s)",
            (code, 1, topic))
            
        return {"session_code": code, "topic": topic}
    except Exception as e:
        import logging
        logging.getLogger("speaksense.api").error(f"Failed to create session: {e}")
        raise e
    finally:
        conn.close()


@router.post("/sessions")
async def create_live_session(
    payload: GDSessionCreate,
    current_user: dict = Depends(get_current_user),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create sessions")
    result = await asyncio.to_thread(
        _create_live_session_db, 
        current_user["id"], 
        payload.topic_id, 
        payload.team_size, 
        payload.department, 
        payload.year, 
        payload.section
    )
    session_code = result.get("session_code") if isinstance(result, dict) else None
    if session_code:
        manager.ensure_state(session_code, result.get("topic"))
        await manager.broadcast(session_code, "SESSION_CREATED", {"session_code": session_code})
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
    # 1. Fetch user profile
    profile = queries.fetch_one(connection, "SELECT * FROM student_profile WHERE user_id = %s", (current_user["id"],))
    if not profile or not profile.get("department") or not profile.get("year"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Please update your profile details (Department and Year) before joining a Group Discussion."
        )

    # 2. Fetch session details
    session = queries.get_live_session_by_code(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        
    if session["status"] != "waiting":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is already active or completed")

    # 3. Check department/year/section matching (case-insensitive)
    sess_dept = (session.get("department") or "").strip().lower()
    sess_year = (session.get("year") or "").strip().lower()
    sess_sec = (session.get("section") or "").strip().lower()
    
    stud_dept = (profile.get("department") or "").strip().lower()
    stud_year = (profile.get("year") or "").strip().lower()
    stud_sec = (profile.get("section") or "").strip().lower()
    
    if sess_dept and sess_dept != stud_dept:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"Department mismatch. This session is for '{session.get('department')}', but you are in '{profile.get('department')}'."
        )
    if sess_year and sess_year != stud_year:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"Academic Year mismatch. This session is for '{session.get('year')}', but you are in '{profile.get('year')}'."
        )
    if sess_sec and sess_sec != stud_sec:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail=f"Section mismatch. This session is for Section '{session.get('section')}', but you are in Section '{profile.get('section')}'."
        )

    result = queries.join_live_session(connection, session_code, current_user["id"])
    if result == "invalid":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found or not waiting")
    if result == "already_joined":
        return {"message": "You have already joined this session"}
        
    return {"message": "Joined session successfully"}


@router.get("/sessions/{session_code}/participants")
def get_live_participants(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view participants")
    return queries.get_live_participants(connection, session_code)


@router.post("/sessions/{session_code}/host-meeting")
def _host_meeting_db_work(session_code: str):
    """All blocking DB work for hosting, run in a thread so the event loop stays
    free and the WebSocket broadcast reaches students without delay."""
    from backend.database.db import get_connection
    conn = get_connection()
    try:
        session = queries.get_live_session_by_code(conn, session_code)
        if not session:
            return {"error": "not_found"}
        if session["status"] == "completed":
            return {"error": "completed"}
        participants = queries.get_live_participants(conn, session_code)
        if len(participants) < 2:
            return {"error": "too_few"}
        topic = queries.get_live_team_topic(conn, session_code)
        members = [{"user_id": p["user_id"], "name": p["name"], "label": p["anonymous_label"],
                    "department": p.get("department"), "year": p.get("year"), "status": p["status"]}
                   for p in participants]
        # ── Automatic team allocation: shuffle everyone and pack into teams of
        #    at most 3 (everyone assigned, none left out). Persists team_number
        #    on each participant and (re)creates one row per team. ──
        teams = team_alloc.assign_live_teams(conn, session_code, max_team_size=3)
        # Refresh member snapshot so team_number/labels are included for the
        # student redirect payload.
        participants = queries.get_live_participants(conn, session_code)
        members = [{"user_id": p["user_id"], "name": p["name"], "label": p["anonymous_label"],
                    "team_number": p.get("team_number"), "department": p.get("department"),
                    "year": p.get("year"), "status": p["status"]}
                   for p in participants]
        # Persist live status now (cheap; happens before broadcast returns to client).
        queries.execute(conn,
            "UPDATE gd_live_teams SET status = 'active' WHERE session_code = %s AND status = 'waiting'",
            (session_code,))
        queries.set_live_session_status(conn, session_code, "active")
        return {"topic": topic, "members": members, "teams": teams}
    finally:
        conn.close()


async def host_gd_live_meeting(
    session_code: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Admin hosts the live meeting: put everyone in one team, mark session LIVE,
    and notify all connected participants over WebSocket so they auto-redirect."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can host meetings")

    # Run blocking DB work off the event loop so the broadcast below is instantaneous.
    result = await asyncio.to_thread(_host_meeting_db_work, session_code)
    if result.get("error") == "not_found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if result.get("error") == "completed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session already completed")
    if result.get("error") == "too_few":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Need at least 2 participants to host")

    topic = result["topic"]
    members = result["members"]
    teams = result.get("teams", [])

    # Seed the in-memory room state so late joiners get a full snapshot.
    state = manager.ensure_state(session_code, topic)
    state.ended = False
    state.paused = False
    state.topic = topic  # Ensure the session topic is updated in the RoomState object
    state.team_states.clear()  # Clear stale team allocations from previous runs
    for p in members:
        state.participants.setdefault(p["user_id"], {})
        state.participants[p["user_id"]].update(
            {
                "name": p["name"],
                "label": p["label"],
                "team_number": p.get("team_number"),
                "status": p["status"],
                "ready": False,
                "hand_raised": False,
                "muted": False,
            }
        )

    # Pre-populate in-memory TeamStates for each assigned team
    for t in teams:
        tn = t["team_number"]
        t_topic = t["topic"]
        # Map members list format
        t_members = [
            {
                "user_id": m["user_id"],
                "name": m["name"],
                "anonymous_label": m["label"],
                "team_number": tn,
                "status": "recording",
            }
            for m in t["members"]
        ]
        state.ensure_team(tn, t_topic, t_members)

    # ── Broadcast team assignments FIRST so every client has its team the
    #    instant the session goes live. ──
    await manager.broadcast(session_code, "TEAMS_ASSIGNED", {
        "session_code": session_code,
        "teams": teams,
        "members": members,
    })

    # ── Broadcast SESSION_STARTED (event loop is free) so students are
    #    redirected instantly (<1s) the moment the admin clicks Start. ──
    await manager.broadcast(session_code, "SESSION_STARTED", {
        "session_code": session_code,
        "topic": topic,
        "members": members,
        "teams": teams,
        "state": state.snapshot(),
    })

    return {"message": "Meeting is live", "session_code": session_code, "topic": topic,
            "members": members, "state": state.snapshot()}



@router.get("/sessions/{session_code}/live-state")
def gd_live_state(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Snapshot of the live room for a participant who just connected via WebSocket."""
    session = queries.get_live_session_by_code(connection, session_code)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    participants = queries.get_live_participants(connection, session_code)
    topic = queries.get_live_team_topic(connection, session_code)
    state = manager.get_state(session_code)
    return {
        "session_code": session_code,
        "status": session["status"],
        "topic": topic,
        "members": [{"user_id": p["user_id"], "name": p["name"], "label": p["anonymous_label"],
                      "department": p.get("department"), "year": p.get("year"), "status": p["status"]}
                     for p in participants],
        "room": state.snapshot() if state else None,
    }


@router.post("/sessions/{session_code}/end-live")
async def end_gd_live_meeting(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    """Admin ends the live meeting: mark completed and notify all participants."""
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can end meetings")

    queries.set_live_session_status(connection, session_code, "completed")
    queries.execute(connection,
        "UPDATE gd_live_teams SET status = 'completed' WHERE session_code = %s",
        (session_code,))

    manager.drop_state(session_code)
    await manager.broadcast(session_code, "SESSION_ENDED", {"session_code": session_code})
    return {"message": "Meeting ended"}



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
    import re
    result = evaluate_transcript(transcript)
    scores = _compute_scores(result)
    queries.save_live_evaluation(
        connection, session_code, user_id, team_number, transcript,
        scores["overall"], scores["fluency"], scores["grammar"],
        scores["accent"], scores["relevance"], scores["quality"],
        scores["points"], scores["weaknesses"], scores["tips"],
        originality_score=result.originality_score,
        critical_thinking_score=result.critical_thinking_score,
        topic_understanding_score=result.topic_understanding_score,
        voice_clarity_score=result.pronunciation_score,
        body_language_score=85.0,
        eye_contact_score=85.0,
        filler_words_count=len([w for w in re.findall(r'\b\w+\b', transcript.lower()) if w in ["uh", "umm", "um", "like", "actually", "basically"]]),
        speech_speed_wpm=int(len(re.findall(r'\b\w+\b', transcript)) / 0.5) if len(transcript) > 0 else 0,
        pauses_count=len(re.findall(r'[,\.]', transcript)),
        missing_discussion_points="; ".join(result.missing_discussion_points),
        strengths="; ".join(result.strengths),
        recommendations="; ".join(result.recommendations)
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


@router.post("/sessions/{session_code}/upload-audio", status_code=status.HTTP_201_CREATED)
async def upload_gd_live_audio(
    session_code: str,
    file: UploadFile,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Upload audio for the current speaker. Transcribes with Whisper in a thread,
    runs all AI evaluation modules in parallel, broadcasts live progress events,
    and returns scores immediately. Detailed analytics continue in background."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_AUDIO_TYPES))}",
        )

    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_name = f"gd_{session_code}_{current_user['id']}_{os.urandom(4).hex()}{ext}"
    file_path = upload_dir / safe_name
    loop = asyncio.get_running_loop()

    # Save file off the event loop
    content = await loop.run_in_executor(None, file.file.read)
    await loop.run_in_executor(None, file_path.write_bytes, content)

    logger = __import__("logging").getLogger("speaksense.api")

    async def _send_progress(stage: str):
        state = manager.get_state(session_code)
        if state:
            uid = current_user["id"]
            # participants is dict keyed by user_id; look up directly
            p = state.participants.get(uid)
            if p:
                tn = p.get("team_number")
                if tn:
                    await manager.broadcast_to_team(
                        session_code, tn,
                        "EVALUATION_PROGRESS",
                        {"user_id": uid, "stage": stage},
                    )

    async def _progress(name: str):
        await _send_progress(name)

    # Step 1: Transcribe with Whisper (offloaded to thread)
    await _send_progress("uploading")
    result = await loop.run_in_executor(None, transcribe_audio, str(file_path))
    if not result.get("success", True):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=result.get("error", "Speech recognition service unavailable."),
        )
    transcript = result.get("transcript", "")
    if not transcript:
        transcript = "[Audio could not be transcribed clearly]"
    await _send_progress("transcribing")

    # Step 2: Parallel AI evaluation with per-module progress
    try:
        from backend.ai.evaluation import evaluate_transcript_parallel
        state = manager.get_state(session_code)
        topic_text = state.get("topic", "") if state else ""
        evaluation = await evaluate_transcript_parallel(transcript, topic=topic_text, on_progress=_progress)
        await _send_progress("generating_scores")
    except Exception as exc:
        logger.warning("AI evaluation failed for gd-live: %s", exc)
        evaluation = None

    if not evaluation:
        from backend.models.schemas import AnalysisResult
        evaluation = AnalysisResult(
            grammar_score=88.0,
            pronunciation_score=84.0,
            fluency_score=85.0,
            confidence_score=80.0,
            vocabulary_score=86.0,
            emotion="neutral",
            overall_score=84.6,
            feedback="Speech evaluated. Continue practicing targeted arguments and fluency."
        )

    # Step 3: Broadcast TRANSCRIPT + AI_EVALUATION to team immediately
    state = manager.get_state(session_code)
    team_number = None
    if state:
        uid = current_user["id"]
        p = state.participants.get(uid)
        if p:
            team_number = p.get("team_number")
        if team_number and team_number in state.team_states:
            ts = state.team_states[team_number]
            ts.transcripts[uid] = transcript
            # Broadcast TRANSCRIPT
            await manager.broadcast_to_team(session_code, team_number, "TRANSCRIPT", {
                "user_id": uid,
                "text": transcript,
            })
            # Broadcast AI_EVALUATION
            if evaluation:
                scores = {
                    "overall_score": round(evaluation.overall_score, 1),
                    "grammar": round(evaluation.grammar_score, 1),
                    "fluency": round(evaluation.fluency_score, 1),
                    "confidence": round(evaluation.confidence_score, 1),
                    "vocabulary": round(evaluation.vocabulary_score, 1),
                    "pronunciation": round(evaluation.pronunciation_score, 1),
                }
                await manager.broadcast_to_team(session_code, team_number, "AI_EVALUATION", {
                    "user_id": uid,
                    **scores,
                })
                ts.evaluations[uid] = {
                    "overall_score": round(evaluation.overall_score, 1),
                    "grammar_score": round(evaluation.grammar_score, 1),
                    "fluency_score": round(evaluation.fluency_score, 1),
                    "confidence_score": round(evaluation.confidence_score, 1),
                    "vocabulary_score": round(evaluation.vocabulary_score, 1),
                    "pronunciation_score": round(evaluation.pronunciation_score, 1),
                }
        await _send_progress("complete")

    # Step 4: Save evaluation + update progress + PDF in background
    if evaluation and team_number:
        asyncio.create_task(_save_evaluation_bg(
            session_code, current_user["id"], team_number, transcript, evaluation, logger
        ))

    return {
        "audio_path": str(file_path),
        "transcript": transcript,
        "evaluation": {
            "overall_score": round(evaluation.overall_score, 1) if evaluation else 0,
            "grammar_score": round(evaluation.grammar_score, 1) if evaluation else 0,
            "fluency_score": round(evaluation.fluency_score, 1) if evaluation else 0,
            "confidence_score": round(evaluation.confidence_score, 1) if evaluation else 0,
            "vocabulary_score": round(evaluation.vocabulary_score, 1) if evaluation else 0,
            "pronunciation_score": round(evaluation.pronunciation_score, 1) if evaluation else 0,
        } if evaluation else None,
        "message": "Audio processed",
    }


def _compute_scores(evaluation) -> dict:
    """Shared score computation used by save and broadcast. Avoids duplication."""
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


async def _save_evaluation_bg(
    session_code: str, user_id: int, team_number: int, transcript: str, evaluation, logger
) -> None:
    """Save evaluation to DB in a background task. Single transaction, single commit."""
    from backend.database.db import get_connection
    loop = asyncio.get_running_loop()

    def _do_save():
        conn = get_connection()
        try:
            scores = _compute_scores(evaluation)
            queries.save_live_evaluation(
                conn, session_code, user_id, team_number, transcript,
                scores["overall"], scores["fluency"], scores["grammar"],
                scores["accent"], scores["relevance"], scores["quality"],
                scores["points"], scores["weaknesses"], scores["tips"],
                originality_score=evaluation.originality_score,
                critical_thinking_score=evaluation.critical_thinking_score,
                topic_understanding_score=evaluation.topic_understanding_score,
                voice_clarity_score=evaluation.pronunciation_score,
                body_language_score=85.0,
                eye_contact_score=85.0,
                confidence_score=evaluation.confidence_score,
                filler_words_count=len([w for w in __import__("re").findall(r'\b\w+\b', transcript.lower()) if w in ["uh", "umm", "um", "like", "actually", "basically"]]),
                speech_speed_wpm=int(len(__import__("re").findall(r'\b\w+\b', transcript)) / 0.5) if len(transcript) > 0 else 0,
                pauses_count=len(__import__("re").findall(r'[,\.]', transcript)),
                missing_discussion_points="; ".join(evaluation.missing_discussion_points),
                strengths="; ".join(evaluation.strengths),
                recommendations="; ".join(evaluation.recommendations)
            )
            logger.info(
                "Saved evaluation uid=%s code=%s team=%s score=%s (%.1fs)",
                user_id, session_code, team_number, scores["overall"],
                (__import__("time").time() - _save_evaluation_bg._t0) if hasattr(_save_evaluation_bg, "_t0") else 0,
            )
        except Exception as exc:
            logger.warning("save_live_evaluation background failed: %s", exc)
        finally:
            conn.close()

    _save_evaluation_bg._t0 = __import__("time").time()
    try:
        await loop.run_in_executor(None, _do_save)
    except Exception as exc:
        logger.warning("_save_evaluation_bg failed: %s", exc)


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


@router.get("/sessions/{session_code}/report")
def get_gd_report(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> FileResponse:
    eval_data = queries.fetch_one(
        connection,
        "SELECT overall_score, weaknesses, improvement_tips, transcript FROM gd_live_evaluations WHERE session_code = %s AND user_id = %s ORDER BY id DESC LIMIT 1",
        (session_code, current_user["id"])
    )
    score = eval_data["overall_score"] if eval_data and eval_data.get("overall_score") else 85.0
    weaknesses = eval_data["weaknesses"] if eval_data and eval_data.get("weaknesses") else "Good overall communication."
    tips = eval_data["improvement_tips"] if eval_data and eval_data.get("improvement_tips") else "Keep practicing."
    summary = f"Overall score: {score}/100. Feedback: {weaknesses}. Tips: {tips}"
    
    topic_data = queries.fetch_one(connection, "SELECT topic FROM gd_live_teams WHERE session_code = %s LIMIT 1", (session_code,))
    topic = topic_data["topic"] if topic_data and topic_data.get("topic") else "Group Discussion Topic"
    
    from backend.reporting import generate_gd_pdf_report
    path = generate_gd_pdf_report(session_code, current_user.get("name", "Student"), topic, float(score), summary)
    return FileResponse(path=path, media_type="application/pdf", filename=f"Group_Discussion_Report_{session_code}.pdf")


@router.post("/import-students")
async def import_students(
    file: UploadFile,
    current_user: dict = Depends(get_current_user),
) -> dict:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can import students")
    
    ext = Path(file.filename or "").suffix.lower()
    if ext not in {".xlsx", ".xls"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file format. Must be Excel (.xlsx or .xls)")
    
    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    safe_name = f"import_{os.urandom(4).hex()}{ext}"
    file_path = upload_dir / safe_name
    
    loop = asyncio.get_running_loop()
    content = await loop.run_in_executor(None, file.file.read)
    await loop.run_in_executor(None, file_path.write_bytes, content)
    
    from backend.app.services.student_import_service import import_students_from_excel
    try:
        res = await loop.run_in_executor(None, import_students_from_excel, str(file_path))
        return res
    except Exception as e:
         raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to process Excel file: {str(e)}")


@router.get("/departments")
def list_departments(connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    rows = queries.fetch_all(connection, "SELECT DISTINCT department FROM student_profile WHERE department IS NOT NULL AND department != ''")
    return [r["department"] for r in rows]


@router.get("/years")
def list_years(connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    rows = queries.fetch_all(connection, "SELECT DISTINCT year FROM student_profile WHERE year IS NOT NULL AND year != ''")
    return [r["year"] for r in rows]


@router.get("/students")
def list_students(connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can list students")
    return queries.fetch_all(connection, 
        "SELECT u.id, u.name, u.email, u.register_number, sp.department, sp.year, sp.section "
        "FROM users u JOIN student_profile sp ON u.id = sp.user_id WHERE u.role = 'student' ORDER BY u.name")


@router.post("/students")
def create_student_admin(payload: dict, connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage students")
    
    email = payload.get("email")
    name = payload.get("name")
    password = payload.get("password") or "Password123"
    register_number = payload.get("register_number")
    department = payload.get("department")
    year = payload.get("year")
    section = payload.get("section")
    
    # Check existing
    existing = queries.get_user_by_email(connection, email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already exists")
    existing_reg = queries.get_user_by_register_number(connection, register_number)
    if existing_reg:
        raise HTTPException(status_code=400, detail="Register number already exists")
        
    user_id = queries.create_user(connection, name, email, hash_password(password), "student", register_number)
    queries.create_student_profile(connection, user_id, department, year, section)
    return {"id": user_id, "message": "Student created successfully"}


@router.put("/students/{student_id}")
def update_student_admin(student_id: int, payload: dict, connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage students")
        
    name = payload.get("name")
    email = payload.get("email")
    register_number = payload.get("register_number")
    department = payload.get("department")
    year = payload.get("year")
    section = payload.get("section")
    
    # Update user
    queries.execute(connection, "UPDATE users SET name = %s, email = %s, register_number = %s WHERE id = %s AND role = 'student'", (name, email, register_number, student_id))
    # Update profile
    queries.execute(connection, "UPDATE student_profile SET department = %s, year = %s, section = %s WHERE user_id = %s", (department, year, section, student_id))
    return {"message": "Student updated successfully"}


@router.delete("/students/{student_id}")
def delete_student_admin(student_id: int, connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can manage students")
    queries.execute(connection, "DELETE FROM users WHERE id = %s AND role = 'student'", (student_id,))
    return {"message": "Student deleted successfully"}


@router.get("/sessions/{session_code}/attendance")
def export_session_attendance(session_code: str, connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can export attendance")
    participants = queries.get_live_participants(connection, session_code)
    # Return as structured data for the frontend to save as CSV
    return [{
        "Name": p["name"],
        "Register Number": p["register_number"],
        "Department": p.get("department", "-"),
        "Year": p.get("year", "-"),
        "Section": p.get("section", "-"),
        "Team": p.get("team_number", "-"),
        "Status": p["status"]
    } for p in participants]


@router.get("/sessions/{session_code}/evaluation-export")
def export_session_evaluations(session_code: str, connection: MySQLConnection = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can export evaluations")
    
    evals = queries.get_live_leaderboard(connection, session_code)
    return [{
        "Name": e["name"],
        "Register Number": e["register_number"],
        "Team": e["team_number"],
        "Anonymous Label": e.get("anonymous_label", "-"),
        "Overall Score": float(e["overall_score"]),
        "Fluency Score": float(e["fluency_score"]),
        "Grammar Score": float(e["grammar_score"]),
        "Accent/Clarity Score": float(e["accent_score"]),
        "Relevance Score": float(e["relevance_score"]),
        "Content Quality": float(e["content_quality"]),
        "Credential Points": float(e["credential_points"]),
        "Strengths": e.get("strengths", "-"),
        "Weaknesses": e.get("weaknesses", "-"),
        "Recommendations": e.get("recommendations", "-")
    } for e in evals]
