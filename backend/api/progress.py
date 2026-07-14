from fastapi import APIRouter, Depends
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import get_db
from backend.security import get_current_user

router = APIRouter(prefix="/progress", tags=["Progress"])


@router.get("")
def get_student_progress(
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    progress = queries.get_progress(connection, current_user["id"])
    if progress:
        return progress
    return {"student_id": current_user["id"], "average_score": 0, "interviews_completed": 0}
