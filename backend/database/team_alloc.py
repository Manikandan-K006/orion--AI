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
    """Shuffle participants, pack into teams of <= max_team_size, assign a unique
    easy topic to each team, persist ``team_number`` + ``anonymous_label`` and
    return the team structure for the host / WebSocket broadcast."""
    participants = queries.fetch_all(connection,
        "SELECT lp.*, u.name, u.register_number, sp.department, sp.year FROM gd_live_participants lp "
        "JOIN users u ON lp.user_id = u.id "
        "LEFT JOIN student_profile sp ON sp.user_id = u.id "
        "WHERE lp.session_code = %s ORDER BY lp.id",
        (session_code,))
    if not participants:
        return []

    # Wipe any previous assignment so re-hosting reshuffles cleanly.
    queries.execute(connection, "DELETE FROM gd_live_teams WHERE session_code = %s", (session_code,))
    queries.execute(connection,
        "UPDATE gd_live_participants SET team_number = NULL, status = 'joined' WHERE session_code = %s",
        (session_code,))

    rng = random.Random(seed)
    user_ids = [p["user_id"] for p in participants]
    rng.shuffle(user_ids)

    # Pack into teams of at most max_team_size.
    teams: list[list[int]] = []
    i, n = 0, len(user_ids)
    while i < n:
        size = min(max_team_size, n - i)
        teams.append(user_ids[i:i + size])
        i += size

    # Unique topics: shuffle the pool, hand one to each team (wrap only if more
    # teams than topics).
    topic_rows = queries.fetch_all(connection, "SELECT topic FROM gd_easy_topics ORDER BY RAND()")
    topic_pool = [t["topic"] for t in topic_rows] or ["Introduce yourself and share your thoughts"]

    by_id = {p["user_id"]: p for p in participants}
    result: list[dict[str, Any]] = []
    for team_number, members in enumerate(teams, start=1):
        topic = topic_pool[(team_number - 1) % len(topic_pool)]
        queries.execute(connection,
            "INSERT INTO gd_live_teams (session_code, team_number, topic) VALUES (%s, %s, %s)",
            (session_code, team_number, topic))
        team_members = []
        for j, uid in enumerate(members):
            label = f"Member {j + 1}"
            queries.execute(connection,
                "UPDATE gd_live_participants SET team_number = %s, anonymous_label = %s, status = 'assigned' "
                "WHERE session_code = %s AND user_id = %s",
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
