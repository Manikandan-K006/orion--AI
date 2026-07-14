from fastapi import APIRouter, Depends, HTTPException, status
from mysql.connector import MySQLConnection

from backend.database import queries
from backend.database.db import get_db
from backend.models.schemas import QuestionCreate, QuestionUpdate
from backend.security import get_current_user

router = APIRouter(prefix="/questions", tags=["Interview Questions"])


def _require_admin(current_user: dict) -> None:
    if current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can perform this action")


@router.get("")
def get_questions(
    _: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> list[dict]:
    return queries.list_questions(connection)


@router.post("", status_code=status.HTTP_201_CREATED)
def add_question(
    payload: QuestionCreate,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    _require_admin(current_user)
    question_id = queries.create_question(connection, payload.question_text, payload.category, payload.difficulty)
    return {"id": question_id, "message": "Question added successfully"}


@router.put("/{question_id}")
def update_question(
    question_id: int,
    payload: QuestionUpdate,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    _require_admin(current_user)
    rows = queries.update_question(connection, question_id, payload.question_text, payload.category, payload.difficulty)
    if rows == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return {"message": "Question updated successfully"}


@router.delete("/{question_id}")
def delete_question(
    question_id: int,
    current_user: dict = Depends(get_current_user),
    connection: MySQLConnection = Depends(get_db),
) -> dict:
    _require_admin(current_user)
    rows = queries.delete_question(connection, question_id)
    if rows == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return {"message": "Question deleted successfully"}
