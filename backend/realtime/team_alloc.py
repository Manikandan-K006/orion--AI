"""Automatic team allocation for GD Live sessions.

Teams are formed by randomly shuffling all participants and packing them into
teams of at most ``MAX_TEAM_SIZE`` members. The packing guarantees:

* every participant ends up in exactly one team (never unassigned);
* no team exceeds ``MAX_TEAM_SIZE``;
* the number of teams is minimised (e.g. 4 -> [3, 1], 62 -> 20x3 + 1x2).

The algorithm is deterministic given the shuffled order: we fill as many full
teams of ``MAX_TEAM_SIZE`` as possible, and the remainder (if any, 1 or 2
people) forms one final smaller team.
"""

from __future__ import annotations

import random
from typing import Iterable, Sequence

MAX_TEAM_SIZE = 3


def allocate_teams(
    user_ids: Sequence[int],
    max_team_size: int = MAX_TEAM_SIZE,
    rng: random.Random | None = None,
) -> list[list[int]]:
    """Return a list of teams (each a list of user_ids), randomly shuffled.

    Examples
    --------
    >>> allocate_teams([1, 2], 3)
    [[2, 1]]                      # 2 -> one team
    >>> len(allocate_teams(list(range(62)), 3))
    21                           # 62 -> 20 teams of 3 + 1 team of 2
    """
    if max_team_size < 1:
        raise ValueError("max_team_size must be >= 1")

    ids = list(user_ids)
    if rng is None:
        rng = random.Random()
    rng.shuffle(ids)

    teams: list[list[int]] = []
    i = 0
    n = len(ids)
    while i < n:
        size = min(max_team_size, n - i)
        teams.append(ids[i : i + size])
        i += size
    return teams


def teams_to_assignments(
    teams: Iterable[Sequence[int]],
) -> list[tuple[int, list[int]]]:
    """Convert ``allocate_teams`` output into ``(team_number, [user_ids])`` pairs."""
    return [(idx + 1, list(members)) for idx, members in enumerate(teams)]
