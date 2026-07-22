import random
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
        "SELECT u.id, u.name, u.email, u.register_number, u.role, u.created_at, sp.department, sp.year "
        "FROM users u LEFT JOIN student_profile sp ON u.id = sp.user_id WHERE u.id = %s",
        (user_id,),
    )


def update_password(connection: MySQLConnection, user_id: int, new_password_hash: str) -> int:
    return execute(
        connection,
        "UPDATE users SET password_hash = %s WHERE id = %s",
        (new_password_hash, user_id),
    )



def create_user(connection: MySQLConnection, name: str, email: str, password_hash: str, role: str, register_number: str = "") -> int:
    return execute(
        connection,
        "INSERT INTO users (name, email, password_hash, role, register_number) VALUES (%s, %s, %s, %s, %s)",
        (name, email, password_hash, role, register_number),
    )


def update_password(connection: MySQLConnection, user_id: int, password_hash: str) -> int:
    return execute(
        connection,
        "UPDATE users SET password_hash = %s WHERE id = %s",
        (password_hash, user_id),
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


def upsert_progress(connection: MySQLConnection, student_id: int, average_score: float = 0, interviews_completed: int = 0, total_credits: float = 0) -> int:
    get_progress(connection, student_id)
    return 1


def get_progress(connection: MySQLConnection, student_id: int) -> dict[str, Any] | None:
    # 1. Interview sessions
    int_row = fetch_one(connection, 
        "SELECT COUNT(DISTINCT id) as count, COALESCE(SUM(total_score), 0) as sum_score FROM interview_session WHERE student_id = %s AND status = 'completed'", 
        (student_id,))
    int_count = int(int_row["count"] or 0) if int_row else 0
    int_sum = float(int_row["sum_score"] or 0.0) if int_row else 0.0

    # 2. Solo practice sessions
    solo_row = fetch_one(connection, 
        "SELECT COUNT(DISTINCT id) as count, COALESCE(SUM(overall_score), 0) as sum_score FROM solo_practice_sessions WHERE user_id = %s AND status = 'completed'", 
        (student_id,))
    solo_count = int(solo_row["count"] or 0) if solo_row else 0
    solo_sum = float(solo_row["sum_score"] or 0.0) if solo_row else 0.0
    solo_credits = solo_count * 5.0

    # 3. Traditional GD evaluations
    gd_row = fetch_one(connection,
        "SELECT COUNT(DISTINCT session_code) as count, COALESCE(SUM(overall_score), 0) as sum_score, COALESCE(SUM(credential_points), 0) as sum_credits "
        "FROM gd_evaluation WHERE user_id = %s",
        (student_id,))
    gd_count = int(gd_row["count"] or 0) if gd_row else 0
    gd_sum = float(gd_row["sum_score"] or 0.0) if gd_row else 0.0
    gd_credits = float(gd_row["sum_credits"] or 0.0) if gd_row else 0.0

    # 4. GD Live evaluations
    live_row = fetch_one(connection,
        "SELECT COUNT(DISTINCT session_code) as count, COALESCE(SUM(overall_score), 0) as sum_score, COALESCE(SUM(credential_points), 0) as sum_credits "
        "FROM gd_live_evaluations WHERE user_id = %s",
        (student_id,))
    live_count = int(live_row["count"] or 0) if live_row else 0
    live_sum = float(live_row["sum_score"] or 0.0) if live_row else 0.0
    live_credits = float(live_row["sum_credits"] or 0.0) if live_row else 0.0

    total_count = int_count + solo_count + gd_count + live_count
    total_score_sum = int_sum + solo_sum + gd_sum + live_sum
    average_score = round(total_score_sum / total_count, 2) if total_count > 0 else 0.0
    total_credits = solo_credits + gd_credits + live_credits

    # Persist the calculated values to the progress table
    execute(connection, 
            "INSERT INTO progress (student_id, average_score, interviews_completed, total_credits) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE average_score = VALUES(average_score), "
            "interviews_completed = VALUES(interviews_completed), total_credits = VALUES(total_credits), updated_at = CURRENT_TIMESTAMP",
            (student_id, average_score, total_count, total_credits))

    row = fetch_one(connection, "SELECT student_id, average_score, interviews_completed, total_credits, updated_at FROM progress WHERE student_id = %s",
                     (student_id,))
    if row:
        row["average_score"] = float(row["average_score"])
        row["total_credits"] = float(row["total_credits"])
    return row


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
        "SELECT * FROM solo_practice_sessions WHERE user_id=%s AND status='completed' ORDER BY created_at DESC",
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
        return None
    seen.add(quote["id"])
    new_seen = ",".join(str(x) for x in sorted(seen))

    execute(connection,
        "INSERT INTO solo_practice_usage (user_id, total_sessions, seen_quote_ids) VALUES (%s, 0, %s) "
        "ON DUPLICATE KEY UPDATE seen_quote_ids = %s",
        (user_id, new_seen, new_seen))

    return quote


def get_random_gd_quote(connection: MySQLConnection) -> dict[str, Any] | None:
    return fetch_one(connection,
        "SELECT id, quote, author FROM motivational_quotes ORDER BY RAND() LIMIT 1")


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
        WITH all_scores AS (
            SELECT user_id, overall_score, grammar_score, fluency_score, accent_score AS accent, relevance_score AS relevance, content_quality AS content_quality, credential_points, session_code AS ref_id, evaluated_at AS created_at FROM gd_live_evaluations
            UNION ALL
            SELECT user_id, overall_score, grammar_score, fluency_score, accent_score AS accent, 80.0 AS relevance, delivery_score AS content_quality, ROUND(overall_score * 0.5, 2) AS credential_points, CAST(id AS CHAR) AS ref_id, created_at FROM solo_practice_sessions
            UNION ALL
            SELECT user_id, overall_score, grammar_score, fluency_score, accent_score AS accent, relevance_score AS relevance, content_quality_score AS content_quality, credential_points, session_code AS ref_id, created_at FROM gd_evaluation
        )
        SELECT 
            u.id, u.name, u.register_number,
            COALESCE(sp.department, 'N/A') AS department,
            COALESCE(sp.year, 'N/A') AS year,
            ROUND(COALESCE(AVG(s.overall_score), 0), 1) AS overall_score,
            ROUND(COALESCE(AVG(s.grammar_score), 0), 1) AS grammar,
            ROUND(COALESCE(AVG(s.fluency_score), 0), 1) AS fluency,
            ROUND(COALESCE(AVG(s.accent), 0), 1) AS accent,
            ROUND(COALESCE(AVG(s.relevance), 0), 1) AS relevance,
            ROUND(COALESCE(AVG(s.content_quality), 0), 1) AS content_quality,
            ROUND(COALESCE(SUM(s.credential_points), 0), 1) AS total_credits,
            COUNT(s.ref_id) AS sessions_completed
        FROM users u
        LEFT JOIN student_profile sp ON sp.user_id = u.id
        JOIN all_scores s ON s.user_id = u.id
        WHERE (sp.department = %s OR %s = 'ALL')
          AND (sp.year = %s OR %s = 'ALL')
          AND (s.created_at >= %s OR %s IS NULL)
          AND (s.created_at < %s OR %s IS NULL)
        GROUP BY u.id, u.name, u.register_number, sp.department, sp.year
        ORDER BY total_credits DESC, overall_score DESC
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
    query = """
        WITH all_scores AS (
            SELECT user_id, overall_score, session_code AS ref_id, evaluated_at AS created_at FROM gd_live_evaluations
            UNION ALL
            SELECT user_id, overall_score, CAST(id AS CHAR) AS ref_id, created_at FROM solo_practice_sessions
            UNION ALL
            SELECT user_id, overall_score, session_code AS ref_id, created_at FROM gd_evaluation
        )
        SELECT
            ROUND(COALESCE(MAX(s.overall_score), 0), 1) AS top_score,
            COUNT(DISTINCT s.user_id) AS active_participants,
            ROUND(COALESCE(AVG(s.overall_score), 0), 1) AS average_score,
            COUNT(s.ref_id) AS total_interviews
        FROM all_scores s
        LEFT JOIN student_profile sp ON sp.user_id = s.user_id
        WHERE (sp.department = %s OR %s = 'ALL')
          AND (sp.year = %s OR %s = 'ALL')
          AND (s.created_at >= %s OR %s IS NULL)
          AND (s.created_at < %s OR %s IS NULL)
    """
    params = (department, department, year, year, start_date, start_date, end_date, end_date)
    stats = fetch_one(connection, query, params)

    return {
        "top_score": round(float(stats["top_score"]), 1) if stats and stats.get("top_score") else 0,
        "active_participants": stats["active_participants"] if stats and stats.get("active_participants") else 0,
        "average_score": round(float(stats["average_score"]), 1) if stats and stats.get("average_score") else 0,
        "total_interviews": stats["total_interviews"] if stats and stats.get("total_interviews") else 0,
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


# ──────────────────────────────────────────────
# GD Invitations
# ──────────────────────────────────────────────

def create_gd_invitation(connection: MySQLConnection, session_code: str, from_user_id: int, to_user_id: int) -> int:
    return execute(connection,
        "INSERT IGNORE INTO gd_invitations (session_code, from_user_id, to_user_id, status) VALUES (%s, %s, %s, 'pending')",
        (session_code, from_user_id, to_user_id))


def get_pending_invitations(connection: MySQLConnection, user_id: int) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT gi.id, gi.session_code, gi.status, gi.created_at, "
        "u.id AS from_user_id, u.name AS from_name, u.register_number AS from_register, "
        "gt.topic, gs.status AS session_status "
        "FROM gd_invitations gi "
        "JOIN users u ON gi.from_user_id = u.id "
        "JOIN gd_sessions gs ON gi.session_code = gs.session_code "
        "JOIN gd_topics gt ON gs.topic_id = gt.id "
        "WHERE gi.to_user_id = %s AND gi.status = 'pending' "
        "ORDER BY gi.created_at DESC",
        (user_id,))


def accept_invitation(connection: MySQLConnection, invitation_id: int, user_id: int) -> bool:
    inv = fetch_one(connection,
        "SELECT session_code, to_user_id FROM gd_invitations WHERE id = %s AND status = 'pending'",
        (invitation_id,))
    if not inv or inv["to_user_id"] != user_id:
        return False
    session = fetch_one(connection, "SELECT team_size FROM gd_sessions WHERE session_code = %s",
                        (inv["session_code"],))
    if not session:
        return False
    member_count = fetch_one(connection,
        "SELECT COUNT(*) AS cnt FROM gd_team_members WHERE session_code = %s",
        (inv["session_code"],))["cnt"]
    if member_count >= session["team_size"]:
        return False
    execute(connection,
        "INSERT IGNORE INTO gd_team_members (session_code, user_id) VALUES (%s, %s)",
        (inv["session_code"], user_id))
    execute(connection,
        "UPDATE gd_invitations SET status = 'accepted' WHERE id = %s",
        (invitation_id,))
    return True


def decline_invitation(connection: MySQLConnection, invitation_id: int, user_id: int) -> bool:
    result = execute(connection,
        "UPDATE gd_invitations SET status = 'declined' WHERE id = %s AND to_user_id = %s AND status = 'pending'",
        (invitation_id, user_id))
    return result > 0


# ──────────────────────────────────────────────
# GD Live (Anonymous 4-digit code sessions)
# ──────────────────────────────────────────────

def generate_live_code(connection: MySQLConnection) -> str:
    import random, string
    while True:
        code = "".join(random.choices(string.digits, k=4))
        if not fetch_one(connection, "SELECT id FROM gd_live_sessions WHERE session_code = %s AND status != 'completed'", (code,)):
            return code


def create_live_session(connection: MySQLConnection, created_by: int) -> dict[str, Any]:
    code = generate_live_code(connection)
    execute(connection, "INSERT INTO gd_live_sessions (session_code, created_by) VALUES (%s, %s)", (code, created_by))
    topics = fetch_all(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND() LIMIT 21")
    # Pre-create the single discussion team + topic now (no participants yet) so the
    # host "Start" action only flips status to live → instant student redirect (<1s).
    create_live_team_with_topic(connection, code)
    return {"session_code": code, "topics_available": len(topics)}


def list_live_sessions(connection: MySQLConnection) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT ls.*, (SELECT COUNT(*) FROM gd_live_participants WHERE session_code = ls.session_code) AS participant_count, "
        "(SELECT COUNT(*) FROM gd_live_teams WHERE session_code = ls.session_code) AS team_count "
        "FROM gd_live_sessions ls ORDER BY ls.created_at DESC")


def join_live_session(connection: MySQLConnection, session_code: str, user_id: int) -> str:
    existing = fetch_one(connection, "SELECT id FROM gd_live_participants WHERE session_code = %s AND user_id = %s",
                         (session_code, user_id))
    if existing:
        return "already_joined"
    session = fetch_one(connection, "SELECT id FROM gd_live_sessions WHERE session_code = %s AND status = 'waiting'",
                        (session_code,))
    if not session:
        return "invalid"
    execute(connection, "INSERT IGNORE INTO gd_live_participants (session_code, user_id) VALUES (%s, %s)",
            (session_code, user_id))
    execute(connection, "UPDATE gd_live_sessions SET total_participants = total_participants + 1 WHERE session_code = %s",
            (session_code,))
    return "joined"


def allocate_teams(participants: list[dict[str, Any]], max_team_size: int = 3) -> list[dict[str, Any]]:
    """Pure team-allocation algorithm.

    - Input: an ordered list of participant dicts (each must carry at least an
      ``id`` key; other keys are passed through into the team's ``members``).
    - Randomly shuffles the participants on every call.
    - Packs them into teams of at most ``max_team_size`` members, in order, so
      every participant is assigned and none is ever left out. The final team
      simply takes whatever remainder remains (1 or 2 members).
    - Returns a list of team assignments::

          [{"team_number": 1, "members": [participant, participant, participant]},
           {"team_number": 2, "members": [participant, participant]}, ...]

    The algorithm is deterministic in structure (ceil(n / max_team_size) teams)
    but the membership is randomized by the shuffle.
    """
    if not participants:
        return []

    people = list(participants)
    random.shuffle(people)

    teams: list[dict[str, Any]] = []
    team_number = 1
    for i in range(0, len(people), max_team_size):
        team_members = people[i:i + max_team_size]
        teams.append({
            "team_number": team_number,
            "members": team_members,
        })
        team_number += 1
    return teams


def assign_live_teams(
    connection: MySQLConnection,
    session_code: str,
    max_team_size: int = 3,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Randomly shuffle all participants and pack them into teams of at most
    ``max_team_size``. Persists ``team_number`` + ``anonymous_label`` on each
    participant and (re)creates one ``gd_live_teams`` row per team. Returns the
    team structure (team_number, topic, members) for the host/WebSocket.

    Guarantees: every participant is assigned to exactly one team; no team is
    larger than ``max_team_size``; the number of teams is minimised; each team
    gets a unique, age-appropriate discussion topic.
    """
    participants = fetch_all(connection,
        "SELECT lp.*, u.name, u.register_number, sp.department, sp.year FROM gd_live_participants lp "
        "JOIN users u ON lp.user_id = u.id "
        "LEFT JOIN student_profile sp ON sp.user_id = u.id "
        "WHERE lp.session_code = %s ORDER BY lp.id",
        (session_code,))
    if not participants:
        return []

    # Wipe any previous assignment so re-hosting reshuffles cleanly.
    execute(connection, "DELETE FROM gd_live_teams WHERE session_code = %s", (session_code,))
    execute(connection,
        "UPDATE gd_live_participants SET team_number = NULL, status = 'joined' WHERE session_code = %s",
        (session_code,))

    rng = random.Random(seed)
    user_ids = [p["user_id"] for p in participants]
    rng.shuffle(user_ids)

    # Pack into teams of at most max_team_size (last team takes the remainder).
    teams: list[list[int]] = []
    i = 0
    n = len(user_ids)
    while i < n:
        size = min(max_team_size, n - i)
        teams.append(user_ids[i:i + size])
        i += size

    # Unique topics: shuffle the pool and hand one to each team, wrapping only
    # if there are more teams than available topics.
    topic_rows = fetch_all(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND()")
    topic_pool = [t["topic"] for t in topic_rows] or ["Introduce yourself and share your thoughts"]
    by_id = {p["user_id"]: p for p in participants}
    result: list[dict[str, Any]] = []
    for team_number, members in enumerate(teams, start=1):
        topic = topic_pool[(team_number - 1) % len(topic_pool)]
        execute(connection,
            "INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES (%s, %s, %s)",
            (session_code, team_number, topic))
        team_members = []
        for j, uid in enumerate(members):
            label = f"Member {j + 1}"
            execute(connection,
                "UPDATE gd_live_participants SET team_number = %s, anonymous_label = %s, status = 'assigned' WHERE session_code = %s AND user_id = %s",
                (team_number, label, session_code, uid))
            p = by_id[uid]
            team_members.append({
                "user_id": uid,
                "label": label,
                "name": p["name"],
                "register_number": p["register_number"],
                "department": p.get("department"),
                "year": p.get("year"),
            })
        result.append({"team_number": team_number, "topic": topic, "members": team_members})

    return result

def create_live_team_with_topic(connection: MySQLConnection, session_code: str) -> str | None:
    """Create the single discussion team + random topic at session creation time
    (when no participants exist yet) so the host 'Start' action is instant."""
    existing = fetch_one(connection, "SELECT COUNT(*) AS c FROM gd_live_teams WHERE session_code = %s", (session_code,))
    if existing and existing["c"] > 0:
        return get_live_team_topic(connection, session_code)
    topic_row = fetch_one(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND() LIMIT 1")
    topic = topic_row["topic"] if topic_row else "Introduce yourself and share your thoughts"
    execute(connection,
        "INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES (%s, %s, %s)",
        (session_code, 1, topic))
    return topic


def assign_live_single_team(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    """Put ALL participants into the single team (team_number 1) with its topic."""
    participants = fetch_all(connection,
        "SELECT lp.*, u.name, u.register_number, sp.department, sp.year FROM gd_live_participants lp "
        "JOIN users u ON lp.user_id = u.id "
        "LEFT JOIN student_profile sp ON sp.user_id = u.id "
        "WHERE lp.session_code = %s ORDER BY lp.id",
        (session_code,))
    if not participants:
        return []

    topic_row = fetch_one(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND() LIMIT 1")
    topic = topic_row["topic"] if topic_row else "Introduce yourself and share your thoughts"

    execute(connection,
        "INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES (%s, %s, %s)",
        (session_code, 1, topic))
    for j, member in enumerate(participants):
        label = f"Member {j + 1}"
        execute(connection,
            "UPDATE gd_live_participants SET team_number = %s, anonymous_label = %s, status = 'assigned' WHERE id = %s",
            (1, label, member["id"]))

    return [{
        "team_number": 1,
        "topic": topic,
        "members": [{"user_id": m["user_id"], "label": f"Member {idx + 1}", "name": m["name"],
                     "register_number": m["register_number"], "department": m.get("department"),
                     "year": m.get("year")} for idx, m in enumerate(participants)],
    }]


def assign_live_teams(
    connection: MySQLConnection,
    session_code: str,
    max_team_size: int = 3,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    """Randomly shuffle all participants and pack them into teams of at most
    ``max_team_size``. Persists ``team_number`` + ``anonymous_label`` on each
    participant and (re)creates one ``gd_live_teams`` row per team. Returns the
    team structure (team_number, topic, members) for the host/WebSocket.

    Guarantees: every participant is assigned to exactly one team; no team is
    larger than ``max_team_size``; the number of teams is minimised.
    """
    participants = fetch_all(connection,
        "SELECT lp.*, u.name, u.register_number, sp.department, sp.year FROM gd_live_participants lp "
        "JOIN users u ON lp.user_id = u.id "
        "LEFT JOIN student_profile sp ON sp.user_id = u.id "
        "WHERE lp.session_code = %s ORDER BY lp.id",
        (session_code,))
    if not participants:
        return []

    # Wipe any previous assignment so re-hosting reshuffles cleanly.
    execute(connection, "DELETE FROM gd_live_teams WHERE session_code = %s", (session_code,))
    execute(connection,
        "UPDATE gd_live_participants SET team_number = NULL, status = 'joined' WHERE session_code = %s",
        (session_code,))

    rng = random.Random(seed)
    user_ids = [p["user_id"] for p in participants]
    rng.shuffle(user_ids)

    # Pack into teams of at most max_team_size.
    teams: list[list[int]] = []
    i = 0
    n = len(user_ids)
    while i < n:
        size = min(max_team_size, n - i)
        teams.append(user_ids[i : i + size])
        i += size

    by_id = {p["user_id"]: p for p in participants}
    result: list[dict[str, Any]] = []
    for team_number, members in enumerate(teams, start=1):
        topic_row = fetch_one(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND() LIMIT 1")
        topic = topic_row["topic"] if topic_row else "Introduce yourself and share your thoughts"
        execute(connection,
            "INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES (%s, %s, %s)",
            (session_code, team_number, topic))
        team_members = []
        for j, uid in enumerate(members):
            label = f"Member {j + 1}"
            execute(connection,
                "UPDATE gd_live_participants SET team_number = %s, anonymous_label = %s, status = 'assigned' WHERE session_code = %s AND user_id = %s",
                (team_number, label, session_code, uid))
            p = by_id[uid]
            team_members.append({
                "user_id": uid,
                "label": label,
                "name": p["name"],
                "register_number": p["register_number"],
                "department": p.get("department"),
                "year": p.get("year"),
            })
            result.append({"team_number": team_number, "topic": topic, "members": team_members})

    return result


def get_live_teams(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT team_number, topic, status FROM gd_live_teams "
        "WHERE session_code = %s ORDER BY team_number",
        (session_code,))


def get_live_my_team(connection: MySQLConnection, session_code: str, user_id: int) -> dict[str, Any] | None:
    participant = fetch_one(connection,
        "SELECT team_number FROM gd_live_participants WHERE session_code = %s AND user_id = %s",
        (session_code, user_id))
    if not participant or not participant["team_number"]:
        return None
    team = fetch_one(connection,
        "SELECT * FROM gd_live_teams WHERE session_code = %s AND team_number = %s",
        (session_code, participant["team_number"]))
    members = fetch_all(connection,
        "SELECT anonymous_label FROM gd_live_participants WHERE session_code = %s AND team_number = %s ORDER BY id",
        (session_code, participant["team_number"]))
    return {
        "team_number": participant["team_number"],
        "topic": team["topic"],
        "team_status": team["status"],
        "members": [m["anonymous_label"] for m in members],
    }


def get_live_participants(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT lp.*, u.name, u.register_number, sp.department, sp.year FROM gd_live_participants lp "
        "JOIN users u ON lp.user_id = u.id "
        "LEFT JOIN student_profile sp ON sp.user_id = u.id "
        "WHERE lp.session_code = %s ORDER BY lp.team_number, lp.id",
        (session_code,))


def set_live_session_status(connection: MySQLConnection, session_code: str, status: str) -> bool:
    r = execute(connection,
        "UPDATE gd_live_sessions SET status = %s WHERE session_code = %s",
        (status, session_code))
    return r > 0


def get_live_session_status(connection: MySQLConnection, session_code: str) -> str | None:
    row = fetch_one(connection, "SELECT status FROM gd_live_sessions WHERE session_code = %s", (session_code,))
    return row["status"] if row else None


def get_live_team_topic(connection: MySQLConnection, session_code: str) -> str | None:
    row = fetch_one(connection,
        "SELECT topic FROM gd_live_teams WHERE session_code = %s ORDER BY team_number LIMIT 1",
        (session_code,))
    return row["topic"] if row else None


def start_live_team(connection: MySQLConnection, session_code: str, team_number: int) -> bool:
    r = execute(connection,
        "UPDATE gd_live_teams SET status = 'active' WHERE session_code = %s AND team_number = %s AND status = 'waiting'",
        (session_code, team_number))
    return r > 0


def submit_live_transcript(connection: MySQLConnection, session_code: str, user_id: int, transcript: str) -> bool:
    r = execute(connection,
        "UPDATE gd_live_participants SET transcript = %s, status = 'completed' WHERE session_code = %s AND user_id = %s",
        (transcript, session_code, user_id))
    return r > 0


def complete_live_session(connection: MySQLConnection, session_code: str) -> bool:
    r = execute(connection,
        "UPDATE gd_live_sessions SET status = 'completed' WHERE session_code = %s", (session_code,))
    return r > 0


def delete_live_session(connection: MySQLConnection, session_code: str) -> None:
    execute(connection, "DELETE FROM gd_live_evaluations WHERE session_code = %s", (session_code,))
    execute(connection, "DELETE FROM gd_live_participants WHERE session_code = %s", (session_code,))
    execute(connection, "DELETE FROM gd_live_teams WHERE session_code = %s", (session_code,))
    execute(connection, "DELETE FROM gd_live_sessions WHERE session_code = %s", (session_code,))


def get_live_session_by_code(connection: MySQLConnection, session_code: str) -> dict[str, Any] | None:
    return fetch_one(connection,
        "SELECT * FROM gd_live_sessions WHERE session_code = %s", (session_code,))


def get_live_team_participants(connection: MySQLConnection, session_code: str, team_number: int) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT * FROM gd_live_participants WHERE session_code = %s AND team_number = %s",
        (session_code, team_number))


def check_team_all_completed(connection: MySQLConnection, session_code: str, team_number: int) -> bool:
    row = fetch_one(connection,
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS done "
        "FROM gd_live_participants WHERE session_code = %s AND team_number = %s",
        (session_code, team_number))
    return row is not None and row["total"] > 0 and row["total"] == row["done"]


def save_live_evaluation(connection: MySQLConnection, session_code: str, user_id: int,
                         team_number: int, transcript: str,
                         overall_score: float, fluency_score: float,
                         grammar_score: float, accent_score: float,
                         relevance_score: float, content_quality: float,
                         credential_points: float,
                         weaknesses: str, improvement_tips: str) -> int:
    return execute(connection,
        "INSERT INTO gd_live_evaluations (session_code, user_id, team_number, transcript, "
        "overall_score, fluency_score, grammar_score, accent_score, "
        "relevance_score, content_quality, credential_points, weaknesses, improvement_tips) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "overall_score=VALUES(overall_score), fluency_score=VALUES(fluency_score), "
        "grammar_score=VALUES(grammar_score), accent_score=VALUES(accent_score), "
        "relevance_score=VALUES(relevance_score), content_quality=VALUES(content_quality), "
        "credential_points=VALUES(credential_points), weaknesses=VALUES(weaknesses), "
        "improvement_tips=VALUES(improvement_tips), transcript=VALUES(transcript), evaluated_at=CURRENT_TIMESTAMP",
        (session_code, user_id, team_number, transcript,
         overall_score, fluency_score, grammar_score, accent_score,
         relevance_score, content_quality, credential_points, weaknesses, improvement_tips))


def get_live_evaluation_for_user(connection: MySQLConnection, session_code: str, user_id: int) -> dict[str, Any] | None:
    return fetch_one(connection,
        "SELECT e.*, ls.status AS session_status FROM gd_live_evaluations e "
        "JOIN gd_live_sessions ls ON ls.session_code = e.session_code "
        "WHERE e.session_code = %s AND e.user_id = %s",
        (session_code, user_id))


def get_live_leaderboard(connection: MySQLConnection, session_code: str) -> list[dict[str, Any]]:
    return fetch_all(connection,
        "SELECT e.*, u.name, u.register_number, lp.anonymous_label FROM gd_live_evaluations e "
        "JOIN users u ON u.id = e.user_id "
        "LEFT JOIN gd_live_participants lp ON lp.session_code = e.session_code AND lp.user_id = e.user_id "
        "WHERE e.session_code = %s ORDER BY e.overall_score DESC",
        (session_code,))
