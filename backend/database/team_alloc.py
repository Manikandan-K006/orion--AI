"""Team allocation for GD Live sessions.

Pure, deterministic-structure algorithm:
  * shuffle all participants (randomized every call),
  * pack into teams of at most MAX_TEAM_SIZE (default 3),
  * the final team simply takes the remaining members (1 or 2),
  * every participant lands in exactly one team — nobody is left out.
Each team gets a unique, age-appropriate discussion topic drawn (shuffled)
from ``gd_easy_topics``; only if there are more teams than topics does a
topic wrap around.
"""

from __future__ import annotations

import random
from typing import Any

from mysql.connector import MySQLConnection

from backend.database import queries


MAX_TEAM_SIZE = 3


def allocate_teams(participants: list[dict[str, Any]], max_team_size: int = MAX_TEAM_SIZE) -> list[dict[str, Any]]:
    """Pure team-allocation algorithm.

    Input  : an ordered list of participant dicts (each carrying at least an
              ``id``/``user_id`` key; other keys pass through to the team).
    Output : [{"team_number": int, "members": [participant, ...]}, ...]
    """
    if not participants:
        return []

    people = list(participants)
    random.shuffle(people)

    teams: list[dict[str, Any]] = []
    team_number = 1
    for i in range(0, len(people), max_team_size):
        teams.append({
            "team_number": team_number,
            "members": people[i:i + max_team_size],
        })
        team_number += 1
    return teams


def assign_live_teams(
    connection: MySQLConnection,
    session_code: str,
    max_team_size: int = MAX_TEAM_SIZE,
    seed: int | None = None,
) -> list[dict[str, Any]]:
    # Retrieve the session to find its team_size
    session_row = queries.fetch_one(connection, "SELECT team_size FROM gd_live_sessions WHERE session_code = %s", (session_code,))
    if session_row and session_row.get("team_size"):
        max_team_size = session_row["team_size"]
        
    participants = queries.fetch_all(connection,
        "SELECT lp.*, u.name, u.register_number, sp.department, sp.year, sp.section FROM gd_live_participants lp "
        "JOIN users u ON lp.user_id = u.id "
        "LEFT JOIN student_profile sp ON sp.user_id = u.id "
        "WHERE lp.session_code = %s ORDER BY lp.id",
        (session_code,))
    if not participants:
        return []

    # Wipe any previous assignment
    queries.execute(connection, "DELETE FROM gd_live_teams WHERE session_code = %s", (session_code,))
    queries.execute(connection,
        "UPDATE gd_live_participants SET team_number = NULL, status = 'joined' WHERE session_code = %s",
        (session_code,))

    user_ids = [p["user_id"] for p in participants]
    n = len(user_ids)

    # Teammate pairing optimization (avoid repeated teammates)
    pair_history = {}
    if n > 1:
        placeholders = ", ".join(["%s"] * n)
        history_rows = queries.fetch_all(connection,
            f"SELECT p1.user_id AS u1, p2.user_id AS u2, COUNT(*) AS joint_count "
            f"FROM gd_live_participants p1 "
            f"JOIN gd_live_participants p2 ON p1.session_code = p2.session_code AND p1.team_number = p2.team_number "
            f"JOIN gd_live_sessions s ON p1.session_code = s.session_code "
            f"WHERE s.status = 'completed' AND p1.user_id < p2.user_id "
            f"AND p1.user_id IN ({placeholders}) AND p2.user_id IN ({placeholders}) "
            f"GROUP BY p1.user_id, p2.user_id",
            tuple(user_ids) + tuple(user_ids))
        for r in history_rows:
            pair_history[(r["u1"], r["u2"])] = r["joint_count"]

    # Generate balanced partitions & find one that minimizes overlap penalty
    rng = random.Random(seed)
    best_shuffle = list(user_ids)
    best_penalty = float("inf")

    # Balanced team size determination helper
    def get_balanced_sizes(total_n, target_s):
        if total_n <= 5:
            return [total_n]
        num_teams = total_n // target_s
        base_size = total_n // num_teams
        if base_size > 5:
            num_teams += 1
            base_size = total_n // num_teams
        remainder = total_n % num_teams
        sizes = [base_size + 1] * remainder + [base_size] * (num_teams - remainder)
        return sizes

    sizes = get_balanced_sizes(n, max_team_size)

    # Try 100 random shuffles to find the optimal teammates partition
    for _ in range(100):
        current_shuffle = list(user_ids)
        rng.shuffle(current_shuffle)
        
        # Calculate penalty for this partition
        penalty = 0
        idx = 0
        for sz in sizes:
            team_uids = current_shuffle[idx : idx + sz]
            idx += sz
            for a in range(len(team_uids)):
                for b in range(a + 1, len(team_uids)):
                    u1, u2 = min(team_uids[a], team_uids[b]), max(team_uids[a], team_uids[b])
                    penalty += pair_history.get((u1, u2), 0)
        
        if penalty < best_penalty:
            best_penalty = penalty
            best_shuffle = current_shuffle
            if penalty == 0:
                break # Found absolute minimum overlap

    # Split best_shuffle into teams according to sizes
    teams: list[list[int]] = []
    idx = 0
    for sz in sizes:
        teams.append(best_shuffle[idx : idx + sz])
        idx += sz

    # Shuffled topic list from pool
    topic_rows = queries.fetch_all(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND()")
    topic_pool = [t["topic"] for t in topic_rows] or ["Introduce yourself and share your thoughts"]

    by_id = {p["user_id"]: p for p in participants}
    result: list[dict[str, Any]] = []

    # Batch INSERT all teams
    team_rows = [
        (session_code, tn, topic_pool[(tn - 1) % len(topic_pool)])
        for tn in range(1, len(teams) + 1)
    ]
    if team_rows:
        placeholders = ", ".join("(%s, %s, %s)" for _ in team_rows)
        flat_params = tuple(v for row in team_rows for v in row)
        cursor = connection.cursor()
        cursor.execute(
            f"INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES {placeholders}",
            flat_params,
        )
        cursor.close()

    # Batch UPDATE all participants
    update_params = []
    for team_number, members in enumerate(teams, start=1):
        for j, uid in enumerate(members):
            update_params.append((team_number, f"Member {j + 1}", session_code, uid))
    if update_params:
        cursor = connection.cursor()
        cursor.executemany(
            "UPDATE gd_live_participants SET team_number = %s, anonymous_label = %s, status = 'assigned' "
            "WHERE session_code = %s AND user_id = %s",
            update_params,
        )
        cursor.close()

    # Build response format
    for team_number, members in enumerate(teams, start=1):
        topic = topic_pool[(team_number - 1) % len(topic_pool)]
        team_members = []
        for j, uid in enumerate(members):
            p = by_id[uid]
            team_members.append({
                "user_id": uid,
                "label": f"Member {j + 1}",
                "name": p["name"],
                "register_number": p["register_number"],
                "department": p.get("department"),
                "year": p.get("year"),
                "section": p.get("section"),
            })
        result.append({"team_number": team_number, "topic": topic, "members": team_members})

    return result
