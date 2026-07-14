from typing import Any

from mysql.connector import MySQLConnection


def fetch_one(connection: MySQLConnection, query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(query, params)
        return cursor.fetchone()
    finally:
        cursor.close()


def fetch_all(connection: MySQLConnection, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(query, params)
        return cursor.fetchall()
    finally:
        cursor.close()


def execute(connection: MySQLConnection, query: str, params: tuple[Any, ...] = ()) -> int:
    cursor = connection.cursor()
    try:
        cursor.execute(query, params)
        connection.commit()
        return cursor.lastrowid or cursor.rowcount
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()


def get_user_by_email(connection: MySQLConnection, email: str) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        """
        SELECT id, name, email, password_hash, role, created_at
        FROM users
        WHERE email = %s
        """,
        (email,),
    )


def get_user_by_id(connection: MySQLConnection, user_id: int) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        """
        SELECT id, name, email, role, created_at
        FROM users
        WHERE id = %s
        """,
        (user_id,),
    )


def create_user(connection: MySQLConnection, name: str, email: str, password_hash: str, role: str) -> int:
    return execute(
        connection,
        """
        INSERT INTO users (name, email, password_hash, role)
        VALUES (%s, %s, %s, %s)
        """,
        (name, email, password_hash, role),
    )


def create_student_profile(connection: MySQLConnection, user_id: int, department: str | None, year: str | None) -> int:
    return execute(
        connection,
        """
        INSERT INTO student_profile (user_id, department, year)
        VALUES (%s, %s, %s)
        """,
        (user_id, department, year),
    )


def list_questions(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(
        connection,
        """
        SELECT id, question_text, category, difficulty, created_at
        FROM interview_questions
        ORDER BY id DESC
        """,
    )


def create_question(connection: MySQLConnection, question_text: str, category: str, difficulty: str) -> int:
    return execute(
        connection,
        """
        INSERT INTO interview_questions (question_text, category, difficulty)
        VALUES (%s, %s, %s)
        """,
        (question_text, category, difficulty),
    )


def create_interview_session(connection: MySQLConnection, student_id: int, title: str, status: str) -> int:
    return execute(
        connection,
        """
        INSERT INTO interview_session (student_id, title, status)
        VALUES (%s, %s, %s)
        """,
        (student_id, title, status),
    )


def get_session(connection: MySQLConnection, session_id: int) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        """
        SELECT id, student_id, title, status, total_score, created_at, completed_at
        FROM interview_session
        WHERE id = %s
        """,
        (session_id,),
    )


def list_sessions_for_student(connection: MySQLConnection, student_id: int) -> list[dict[str, Any]]:
    return fetch_all(
        connection,
        """
        SELECT id, student_id, title, status, total_score, created_at, completed_at
        FROM interview_session
        WHERE student_id = %s
        ORDER BY created_at DESC
        """,
        (student_id,),
    )


def create_interview_response(
    connection: MySQLConnection,
    session_id: int,
    question_id: int,
    audio_path: str | None,
    transcript: str,
) -> int:
    return execute(
        connection,
        """
        INSERT INTO interview_response (session_id, question_id, audio_path, transcript)
        VALUES (%s, %s, %s, %s)
        """,
        (session_id, question_id, audio_path, transcript),
    )


def create_ai_analysis(
    connection: MySQLConnection,
    response_id: int,
    grammar_score: float,
    pronunciation_score: float,
    fluency_score: float,
    confidence_score: float,
    vocabulary_score: float,
    emotion: str,
    overall_score: float,
    feedback: str,
) -> int:
    return execute(
        connection,
        """
        INSERT INTO ai_analysis (
            response_id, grammar_score, pronunciation_score, fluency_score,
            confidence_score, vocabulary_score, emotion, overall_score, feedback
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            response_id,
            grammar_score,
            pronunciation_score,
            fluency_score,
            confidence_score,
            vocabulary_score,
            emotion,
            overall_score,
            feedback,
        ),
    )


def update_session_score(connection: MySQLConnection, session_id: int, total_score: float, status: str) -> int:
    return execute(
        connection,
        """
        UPDATE interview_session
        SET total_score = %s, status = %s, completed_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """,
        (total_score, status, session_id),
    )


def create_report(connection: MySQLConnection, session_id: int, report_path: str, summary: str) -> int:
    return execute(
        connection,
        """
        INSERT INTO reports (session_id, report_path, summary)
        VALUES (%s, %s, %s)
        """,
        (session_id, report_path, summary),
    )


def upsert_progress(connection: MySQLConnection, student_id: int, average_score: float, interviews_completed: int) -> int:
    return execute(
        connection,
        """
        INSERT INTO progress (student_id, average_score, interviews_completed)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE
            average_score = VALUES(average_score),
            interviews_completed = VALUES(interviews_completed),
            updated_at = CURRENT_TIMESTAMP
        """,
        (student_id, average_score, interviews_completed),
    )


def get_progress(connection: MySQLConnection, student_id: int) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        """
        SELECT student_id, average_score, interviews_completed, updated_at
        FROM progress
        WHERE student_id = %s
        """,
        (student_id,),
    )


def get_completed_session_stats(connection: MySQLConnection, student_id: int) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        """
        SELECT COUNT(*) AS interviews_completed, COALESCE(AVG(total_score), 0) AS average_score
        FROM interview_session
        WHERE student_id = %s AND status = 'completed'
        """,
        (student_id,),
    )


def update_question(connection: MySQLConnection, question_id: int, question_text: str, category: str, difficulty: str) -> int:
    return execute(
        connection,
        """
        UPDATE interview_questions
        SET question_text = %s, category = %s, difficulty = %s
        WHERE id = %s
        """,
        (question_text, category, difficulty, question_id),
    )


def delete_question(connection: MySQLConnection, question_id: int) -> int:
    return execute(
        connection,
        """
        DELETE FROM interview_questions WHERE id = %s
        """,
        (question_id,),
    )


def get_report_by_session(connection: MySQLConnection, session_id: int) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        """
        SELECT id, session_id, report_path, summary, created_at
        FROM reports
        WHERE session_id = %s
        """,
        (session_id,),
    )
