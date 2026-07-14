from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import get_db
from backend.reporting import generate_pdf_report
from backend.security import get_current_user

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.post("/{session_id}", status_code=status.HTTP_201_CREATED)
def create_session_report(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    session = queries.get_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found")
    if session["student_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This session belongs to another user")
    if session["total_score"] is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Complete analysis before report generation")

    summary = "Interview completed. Review communication scores and continue practicing targeted weak areas."
    path = generate_pdf_report(session_id, current_user["name"], float(session["total_score"]), summary)
    report_id = queries.create_report(connection, session_id, path, summary)
    return {"id": report_id, "session_id": session_id, "report_path": path, "summary": summary}


@router.get("/{session_id}/download")
def download_report(
    session_id: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> FileResponse:
    session = queries.get_session(connection, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found")
    if session["student_id"] != current_user["id"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This session belongs to another user")

    report = queries.get_report_by_session(connection, session_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found. Generate it first via POST.")

    report_path = Path(report["report_path"])
    if not report_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report file not found on disk")

    return FileResponse(
        path=str(report_path),
        media_type="application/pdf",
        filename=f"interview_report_{session_id}.pdf",
    )
