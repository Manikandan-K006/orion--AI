import secrets
import string
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
        "SELECT id, name, email, register_number, password_hash, role, created_at FROM users WHERE email = %s",
        (email,),
    )


def get_user_by_register_number(connection: MySQLConnection, register_number: str) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        "SELECT id, name, email, register_number, password_hash, role FROM users WHERE register_number = %s",
        (register_number,),
    )


def get_user_by_id(connection: MySQLConnection, user_id: int) -> dict[str, Any] | None:
    return fetch_one(
        connection,
        "SELECT id, name, email, register_number, role, created_at FROM users WHERE id = %s",
        (user_id,),
    )


def create_user(connection: MySQLConnection, name: str, email: str, password_hash: str, role: str, register_number: str = "") -> int:
    return execute(
        connection,
        "INSERT INTO users (name, email, password_hash, role, register_number) VALUES (%s, %s, %s, %s, %s)",
        (name, email, password_hash, role, register_number),
    )


def create_student_profile(connection: MySQLConnection, user_id: int, department: str | None, year: str | None) -> int:
    return execute(
        connection,
        "INSERT INTO student_profile (user_id, department, year) VALUES (%s, %s, %s)",
        (user_id, department, year),
    )


def list_questions(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(connection, "SELECT id, question_text, category, difficulty, created_at FROM interview_questions ORDER BY id DESC")


def create_question(connection: MySQLConnection, question_text: str, category: str, difficulty: str) -> int:
    return execute(connection, "INSERT INTO interview_questions (question_text, category, difficulty) VALUES (%s, %s, %s)",
                   (question_text, category, difficulty))


def create_interview_session(connection: MySQLConnection, student_id: int, title: str, status: str) -> int:
    return execute(connection, "INSERT INTO interview_session (student_id, title, status) VALUES (%s, %s, %s)",
                   (student_id, title, status))


def get_session(connection: MySQLConnection, session_id: int) -> dict[str, Any] | None:
    return fetch_one(connection, "SELECT id, student_id, title, status, total_score, created_at, completed_at FROM interview_session WHERE id = %s",
                     (session_id,))


def list_sessions_for_student(connection: MySQLConnection, student_id: int) -> list[dict[str, Any]]:
    return fetch_all(connection, "SELECT id, student_id, title, status, total_score, created_at, completed_at FROM interview_session WHERE student_id = %s ORDER BY created_at DESC",
                     (student_id,))


def create_interview_response(connection: MySQLConnection, session_id: int, question_id: int, audio_path: str | None, transcript: str) -> int:
    return execute(connection, "INSERT INTO interview_response (session_id, question_id, audio_path, transcript) VALUES (%s, %s, %s, %s)",
                   (session_id, question_id, audio_path, transcript))


def create_ai_analysis(connection: MySQLConnection, response_id: int, grammar_score: float, pronunciation_score: float, fluency_score: float, confidence_score: float, vocabulary_score: float, emotion: str, overall_score: float, feedback: str) -> int:
    return execute(connection, "INSERT INTO ai_analysis (response_id, grammar_score, pronunciation_score, fluency_score, confidence_score, vocabulary_score, emotion, overall_score, feedback) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                   (response_id, grammar_score, pronunciation_score, fluency_score, confidence_score, vocabulary_score, emotion, overall_score, feedback))


def update_session_score(connection: MySQLConnection, session_id: int, total_score: float, status: str) -> int:
    return execute(connection, "UPDATE interview_session SET total_score = %s, status = %s, completed_at = CURRENT_TIMESTAMP WHERE id = %s",
                   (total_score, status, session_id))


def create_report(connection: MySQLConnection, session_id: int, report_path: str, summary: str) -> int:
    return execute(connection, "INSERT INTO reports (session_id, report_path, summary) VALUES (%s, %s, %s)",
                   (session_id, report_path, summary))


def upsert_progress(connection: MySQLConnection, student_id: int, average_score: float, interviews_completed: int, total_credits: float = 0) -> int:
    return execute(connection, "INSERT INTO progress (student_id, average_score, interviews_completed, total_credits) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE average_score = VALUES(average_score), interviews_completed = VALUES(interviews_completed), total_credits = total_credits + VALUES(total_credits), updated_at = CURRENT_TIMESTAMP",
                   (student_id, average_score, interviews_completed, total_credits))


def get_progress(connection: MySQLConnection, student_id: int) -> dict[str, Any] | None:
    return fetch_one(connection, "SELECT student_id, average_score, interviews_completed, total_credits, updated_at FROM progress WHERE student_id = %s",
                     (student_id,))


def get_completed_session_stats(connection: MySQLConnection, student_id: int) -> dict[str, Any] | None:
    return fetch_one(connection, "SELECT COUNT(*) AS interviews_completed, COALESCE(AVG(total_score), 0) AS average_score FROM interview_session WHERE student_id = %s AND status = 'completed'",
                     (student_id,))


def update_question(connection: MySQLConnection, question_id: int, question_text: str, category: str, difficulty: str) -> int:
    return execute(connection, "UPDATE interview_questions SET question_text = %s, category = %s, difficulty = %s WHERE id = %s",
                   (question_text, category, difficulty, question_id))


def delete_question(connection: MySQLConnection, question_id: int) -> int:
    return execute(connection, "DELETE FROM interview_questions WHERE id = %s", (question_id,))


def get_report_by_session(connection: MySQLConnection, session_id: int) -> dict[str, Any] | None:
    return fetch_one(connection, "SELECT id, session_id, report_path, summary, created_at FROM reports WHERE session_id = %s",
                     (session_id,))


# ──────────────────────────────────────────────
# GD — Topic refresh support
# ──────────────────────────────────────────────

def list_gd_topics(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(connection, "SELECT id, topic, category FROM gd_topics ORDER BY id")


def refresh_gd_topic(connection: MySQLConnection, user_id: int) -> dict:
    """Return a random unseen topic for the user. Max 3 refreshes per user."""
    row = fetch_one(connection,
        "SELECT refresh_count, seen_topic_ids FROM gd_topic_refreshes WHERE user_id = %s",
        (user_id,))

    refresh_count = row["refresh_count"] if row else 0
    seen_ids = set()
    if row and row["seen_topic_ids"]:
        seen_ids = set(int(x) for x in row["seen_topic_ids"].split(",") if x)

    if refresh_count >= 3:
        return {"error": "Max refreshes reached (3)"}

    # Get a random topic NOT in seen_ids
    if seen_ids:
        placeholders = ",".join(["%s"] * len(seen_ids))
        topic = fetch_one(connection,
            f"SELECT id, topic, category FROM gd_topics WHERE id NOT IN ({placeholders}) ORDER BY RAND() LIMIT 1",
            tuple(seen_ids))
    else:
        topic = fetch_one(connection,
            "SELECT id, topic, category FROM gd_topics ORDER BY RAND() LIMIT 1")

    if not topic:
        # All topics seen — reset and use any
        topic = fetch_one(connection,
            "SELECT id, topic, category FROM gd_topics ORDER BY RAND() LIMIT 1")
        seen_ids = {topic["id"]}
    else:
        seen_ids.add(topic["id"])

    new_seen = ",".join(str(x) for x in sorted(seen_ids))
    execute(connection,
        "INSERT INTO gd_topic_refreshes (user_id, refresh_count, seen_topic_ids) VALUES (%s, %s, %s) "
        "ON DUPLICATE KEY UPDATE refresh_count = refresh_count + 1, seen_topic_ids = %s",
        (user_id, refresh_count + 1, new_seen, new_seen))

    return topic


def reset_topic_refreshes(connection: MySQLConnection, user_id: int) -> None:
    execute(connection, "DELETE FROM gd_topic_refreshes WHERE user_id = %s", (user_id,))


# ──────────────────────────────────────────────
# GD — Sessions (session_code based)
# ──────────────────────────────────────────────

def _generate_session_code() -> str:
    return ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(12))


def create_gd_session(connection: MySQLConnection, topic_id: int, team_size: int) -> str:
    code = _generate_session_code()
    # ensure uniqueness
    while fetch_one(connection, "SELECT session_code FROM gd_sessions WHERE session_code = %s", (code,)):
        code = _generate_session_code()
    execute(connection, "INSERT INTO gd_sessions (session_code, topic_id, team_size) VALUES (%s, %s, %s)",
            (code, topic_id, team_size))
    return code


def get_gd_session(connection: MySQLConnection, session_code: str) -> dict[str, Any] | None:
    return fetch_one(connection,
        "SELECT gs.*, gt.topic FROM gd_sessions gs JOIN gd_topics gt ON gs.topic_id = gt.id WHERE gs.session_code = %s",
        (session_code,))


def list_gd_sessions(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT gs.*, gt.topic, (SELECT COUNT(*) FROM gd_team_members WHERE session_code = gs.session_code) AS member_count "
        "FROM gd_sessions gs JOIN gd_topics gt ON gs.topic_id = gt.id ORDER BY gs.created_at DESC")


def join_gd_session(connection: MySQLConnection, session_code: str, user_id: int) -> int:
    return execute(connection, "INSERT INTO gd_team_members (session_code, user_id) VALUES (%s, %s) ON DUPLICATE KEY UPDATE user_id=user_id",
                   (session_code, user_id))


def get_gd_team_members(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT u.id, u.name, u.register_number, tm.joined_at FROM gd_team_members tm "
        "JOIN users u ON tm.user_id = u.id WHERE tm.session_code = %s",
        (session_code,))


def is_member_of_gd(connection: MySQLConnection, session_code: str, user_id: int) -> bool:
    return fetch_one(connection, "SELECT id FROM gd_team_members WHERE session_code = %s AND user_id = %s",
                     (session_code, user_id)) is not None


def update_gd_status(connection: MySQLConnection, session_code: str, status: str) -> int:
    completed = ", completed_at = CURRENT_TIMESTAMP" if status == "completed" else ""
    return execute(connection, f"UPDATE gd_sessions SET status = %s{completed} WHERE session_code = %s",
                   (status, session_code))


def create_gd_evaluation(connection: MySQLConnection, session_code: str, user_id: int,
                         fluency: float, grammar: float, accent: float,
                         relevance: float, quality: float, overall: float,
                         transcript: str, points: float) -> int:
    return execute(connection,
        "INSERT INTO gd_evaluation (session_code, user_id, fluency_score, grammar_score, accent_score, "
        "relevance_score, content_quality_score, overall_score, transcript, credential_points) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (session_code, user_id, fluency, grammar, accent, relevance, quality, overall, transcript, points))


def get_gd_evaluations(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT ge.*, u.name, u.register_number FROM gd_evaluation ge "
        "JOIN users u ON ge.user_id = u.id WHERE ge.session_code = %s ORDER BY ge.overall_score DESC",
        (session_code,))


def save_gd_leaderboard(connection: MySQLConnection, session_code: str, user_id: int,
                        rank: int, score: float, points: float) -> int:
    return execute(connection,
        "INSERT INTO gd_leaderboard (session_code, user_id, rank_position, overall_score, credential_points) "
        "VALUES (%s, %s, %s, %s, %s)",
        (session_code, user_id, rank, score, points))


def get_gd_leaderboard(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT gl.*, u.name, u.register_number FROM gd_leaderboard gl "
        "JOIN users u ON gl.user_id = u.id WHERE gl.session_code = %s ORDER BY gl.rank_position",
        (session_code,))


# ──────────────────────────────────────────────
# Solo Practice
# ──────────────────────────────────────────────

def create_solo_session(connection: MySQLConnection, user_id: int, topic: str, session_number: int) -> int:
    return execute(connection,
        "INSERT INTO solo_practice_sessions (user_id, topic, status, session_number) VALUES (%s, %s, 'preparation', %s)",
        (user_id, topic, session_number))


def get_solo_session(connection: MySQLConnection, session_id: int) -> dict[str, Any] | None:
    return fetch_one(connection, "SELECT * FROM solo_practice_sessions WHERE id = %s", (session_id,))


def complete_solo_session(connection: MySQLConnection, session_id: int, transcript: str,
                          overall: float, fluency: float, grammar: float, accent: float,
                          delivery: float, weaknesses: str, tips: str) -> int:
    return execute(connection,
        "UPDATE solo_practice_sessions SET status='completed', transcript=%s, overall_score=%s, "
        "fluency_score=%s, grammar_score=%s, accent_score=%s, delivery_score=%s, "
        "weaknesses=%s, improvement_tips=%s, completed_at=CURRENT_TIMESTAMP WHERE id=%s",
        (transcript, overall, fluency, grammar, accent, delivery, weaknesses, tips, session_id))


def get_solo_history(connection: MySQLConnection, user_id: int) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT * FROM solo_practice_sessions WHERE user_id=%s ORDER BY created_at DESC",
        (user_id,))


def get_solo_stats(connection: MySQLConnection, user_id: int) -> dict[str, Any]:
    row = fetch_one(connection, "SELECT * FROM solo_practice_usage WHERE user_id=%s", (user_id,))
    if not row:
        return {"total_sessions": 0, "is_new": True}
    return {**row, "is_new": False}


def upsert_solo_usage(connection: MySQLConnection, user_id: int) -> int:
    return execute(connection,
        "INSERT INTO solo_practice_usage (user_id, total_sessions) VALUES (%s, 1) "
        "ON DUPLICATE KEY UPDATE total_sessions = total_sessions + 1",
        (user_id,))


def get_random_quote(connection: MySQLConnection, user_id: int) -> dict[str, Any] | None:
    usage = fetch_one(connection, "SELECT seen_quote_ids FROM solo_practice_usage WHERE user_id=%s", (user_id,))
    seen = set()
    if usage and usage["seen_quote_ids"]:
        seen = set(int(x) for x in usage["seen_quote_ids"].split(",") if x)

    if seen:
        placeholders = ",".join(["%s"] * len(seen))
        quote = fetch_one(connection,
            f"SELECT id, quote, author FROM motivational_quotes WHERE id NOT IN ({placeholders}) ORDER BY RAND() LIMIT 1",
            tuple(seen))
    else:
        quote = fetch_one(connection,
            "SELECT id, quote, author FROM motivational_quotes ORDER BY RAND() LIMIT 1")

    if not quote:
        # all seen, reset
        quote = fetch_one(connection,
            "SELECT id, quote, author FROM motivational_quotes ORDER BY RAND() LIMIT 1")
        new_seen = str(quote["id"])
    else:
        seen.add(quote["id"])
        new_seen = ",".join(str(x) for x in sorted(seen))

    execute(connection,
        "INSERT INTO solo_practice_usage (user_id, total_sessions, seen_quote_ids) VALUES (%s, 0, %s) "
        "ON DUPLICATE KEY UPDATE seen_quote_ids = %s",
        (user_id, new_seen, new_seen))

    return quote


def get_last_solo_session(connection: MySQLConnection, user_id: int) -> dict[str, Any] | None:
    return fetch_one(connection,
        "SELECT overall_score, fluency_score, grammar_score, accent_score, delivery_score, weaknesses "
        "FROM solo_practice_sessions WHERE user_id=%s AND status='completed' ORDER BY created_at DESC LIMIT 1",
        (user_id,))


def list_all_users(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT id, name, register_number FROM users ORDER BY register_number")


# ──────────────────────────────────────────────
# Comprehensive Leaderboard
# ──────────────────────────────────────────────

def get_comprehensive_leaderboard(
    connection: MySQLConnection,
    department: str = "ALL",
    year: str = "ALL",
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    query = """
        SELECT
            u.id, u.name, u.register_number,
            COALESCE(sp.department, 'N/A') AS department,
            COALESCE(sp.year, 'N/A') AS year,
            COALESCE(AVG(ge.overall_score), 0) AS overall_score,
            COALESCE(AVG(ge.grammar_score), 0) AS grammar,
            COALESCE(AVG(ge.fluency_score), 0) AS fluency,
            COALESCE(AVG(ge.accent_score), 0) AS accent,
            COALESCE(AVG(ge.relevance_score), 0) AS relevance,
            COALESCE(AVG(ge.content_quality_score), 0) AS content_quality,
            COALESCE(SUM(ge.credential_points), 0) AS total_credits,
            COUNT(DISTINCT ge.session_code) AS sessions_completed
        FROM gd_evaluation ge
        JOIN users u ON u.id = ge.user_id
        LEFT JOIN student_profile sp ON sp.user_id = u.id
        JOIN gd_sessions gs ON gs.session_code = ge.session_code
        WHERE gs.status = 'completed'
          AND (sp.department = %s OR %s = 'ALL')
          AND (sp.year = %s OR %s = 'ALL')
          AND (gs.completed_at >= %s OR %s IS NULL)
          AND (gs.completed_at < %s OR %s IS NULL)
        GROUP BY u.id, u.name, u.register_number, sp.department, sp.year
        ORDER BY total_credits DESC
    """
    return fetch_all(connection, query,
        (department, department, year, year, start_date, start_date, end_date, end_date))


def get_leaderboard_stats(
    connection: MySQLConnection,
    department: str = "ALL",
    year: str = "ALL",
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    base = """
        FROM gd_evaluation ge
        JOIN gd_sessions gs ON gs.session_code = ge.session_code
        LEFT JOIN student_profile sp ON sp.user_id = ge.user_id
        WHERE gs.status = 'completed'
          AND (sp.department = %s OR %s = 'ALL')
          AND (sp.year = %s OR %s = 'ALL')
          AND (gs.completed_at >= %s OR %s IS NULL)
          AND (gs.completed_at < %s OR %s IS NULL)
    """
    params = (department, department, year, year, start_date, start_date, end_date, end_date)

    top = fetch_one(connection, "SELECT COALESCE(MAX(ge.overall_score), 0) AS top_score" + base, params)
    active = fetch_one(connection, "SELECT COUNT(DISTINCT ge.user_id) AS active_participants" + base, params)
    avg = fetch_one(connection, "SELECT COALESCE(AVG(ge.overall_score), 0) AS avg_score" + base, params)

    # Total interviews today
    today = fetch_one(connection,
        "SELECT COUNT(*) AS total FROM gd_sessions WHERE status='completed' AND DATE(completed_at) = CURDATE()")

    return {
        "top_score": round(float(top["top_score"]), 2) if top else 0,
        "active_participants": active["active_participants"] if active else 0,
        "average_score": round(float(avg["avg_score"]), 2) if avg else 0,
        "total_interviews": today["total"] if today else 0,
    }


def get_all_time_achievers(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(connection, """
        SELECT
            u.id, u.name, u.register_number,
            COALESCE(sp.department, 'N/A') AS department,
            COALESCE(sp.year, 'N/A') AS year,
            COALESCE(SUM(ge.credential_points), 0) AS total_credits,
            COUNT(DISTINCT ge.session_code) AS sessions_completed
        FROM gd_evaluation ge
        JOIN users u ON u.id = ge.user_id
        LEFT JOIN student_profile sp ON sp.user_id = u.id
        JOIN gd_sessions gs ON gs.session_code = ge.session_code
        WHERE gs.status = 'completed'
        GROUP BY u.id, u.name, u.register_number, sp.department, sp.year
        ORDER BY total_credits DESC
        LIMIT 10
    """)
