from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import get_db
from backend.reporting import generate_pdf_report, generate_gd_live_pdf_report, generate_gd_live_excel_report
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


@router.get("/gd-live/{session_code}/pdf")
def download_gd_live_pdf(
    session_code: str,
    user_id: int | None = None,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> FileResponse:
    target_uid = current_user["id"]
    if user_id is not None:
        if current_user.get("role") != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can query other members' reports.")
        target_uid = user_id
        
    eval_data = queries.get_live_evaluation_for_user(connection, session_code, target_uid)
    if not eval_data:
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No evaluation found for this user in this session.")
         
    # Query student name
    user_row = queries.fetch_one(connection, "SELECT name FROM users WHERE id = %s", (target_uid,))
    student_name = user_row["name"] if user_row else "Student"
    
    # Query topic
    topic_row = queries.fetch_one(connection, "SELECT topic FROM gd_live_teams WHERE session_code = %s AND team_number = %s", (session_code, eval_data["team_number"]))
    topic = topic_row["topic"] if topic_row else "Group Discussion"
    
    path = generate_gd_live_pdf_report(session_code, student_name, topic, eval_data)
    
    return FileResponse(
        path=path,
        media_type="application/pdf",
        filename=f"gd_live_report_{session_code}_{target_uid}.pdf",
    )


@router.get("/gd-live/{session_code}/excel")
def download_gd_live_excel(
    session_code: str,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> FileResponse:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can download session Excel sheets.")
        
    evals = queries.get_live_leaderboard(connection, session_code)
    if not evals:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No evaluations found for this session code.")
        
    path = generate_gd_live_excel_report(session_code, evals)
    
    return FileResponse(
        path=path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"gd_live_session_report_{session_code}.xlsx",
    )

