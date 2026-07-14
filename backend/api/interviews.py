import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from mysql.connector import MySQLConnection

from backend.ai.evaluation import evaluate_transcript
from backend.ai.speech_recognition import transcribe_audio
from backend.config import get_settings
from backend.database import queries
from backend.database.db import get_db
from backend.models.schemas import SessionCreate, TextAnalysisRequest
from backend.security import get_current_user

router = APIRouter(prefix="/interviews", tags=["Interviews"])

ALLOWED_AUDIO_TYPES = {".wav", ".mp3", ".m4a", ".webm"}


def _update_progress(connection: MySQLConnection, student_id: int) -> None:
    stats = queries.get_completed_session_stats(connection, student_id)
    if stats:
        queries.upsert_progress(
            connection,
            student_id,
            float(stats["average_score"]),
            int(stats["interviews_completed"]),
        )


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreate,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session_id = queries.create_interview_session(connection, current_user["id"], payload.title, "in_progress")
    return {"id": session_id, "title": payload.title, "status": "in_progress"}


@router.get("/sessions")
def list_sessions(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.list_sessions_for_student(connection, current_user["id"])


@router.post("/analyze-text")
def analyze_text_response(
    payload: TextAnalysisRequest,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_session(connection, payload.session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found")
    if session["student_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This session belongs to another user")

    result = evaluate_transcript(payload.transcript)
    response_id = queries.create_interview_response(
        connection,
        payload.session_id,
        payload.question_id,
        None,
        payload.transcript,
    )
    analysis_id = queries.create_ai_analysis(
        connection,
        response_id,
        result.grammar_score,
        result.pronunciation_score,
        result.fluency_score,
        result.confidence_score,
        result.vocabulary_score,
        result.emotion,
        result.overall_score,
        result.feedback,
    )
    queries.update_session_score(connection, payload.session_id, result.overall_score, "completed")
    _update_progress(connection, current_user["id"])
    return {"response_id": response_id, "analysis_id": analysis_id, "analysis": result.model_dump()}


@router.post("/upload-audio", status_code=status.HTTP_201_CREATED)
def upload_audio(
    file: UploadFile,
    current_user: dict = Depends(get_current_user),
) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_AUDIO_TYPES))}",
        )

    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_name = f"{current_user['id']}_{os.urandom(4).hex()}{ext}"
    file_path = upload_dir / safe_name
    content = file.file.read()
    file_path.write_bytes(content)

    result = transcribe_audio(str(file_path))
    return {
        "audio_path": str(file_path),
        "transcript": result["transcript"],
        "message": result["message"],
    }
