import time
from unittest.mock import MagicMock

# Import helper functions from gd_ws
from backend.realtime.gd_ws import (
    _compute_scores_sync,
    _update_chat_signals,
    TeamState
)
from backend.api.gd_live import _compute_scores

def test_compute_scores_sync_uses_direct_ai_outputs():
    # Setup a mock evaluation output containing real relevance and quality
    mock_eval = MagicMock()
    mock_eval.overall_score = 88.5
    mock_eval.grammar_score = 90.0
    mock_eval.fluency_score = 85.0
    mock_eval.pronunciation_score = 80.0
    mock_eval.confidence_score = 95.0
    mock_eval.vocabulary_score = 82.0
    mock_eval.topic_relevance_score = 94.0
    mock_eval.content_quality_score = 87.0
    mock_eval.weaknesses = ["Vocabulary needs improvement"]
    mock_eval.recommendations = ["Read widely and learn new words daily"]

    scores = _compute_scores_sync(mock_eval)
    assert scores["overall"] == 88.5
    assert scores["relevance"] == 94.0
    assert scores["quality"] == 87.0
    assert scores["weaknesses"] == "Vocabulary needs improvement"
    assert scores["tips"] == "Read widely and learn new words daily"


def test_update_chat_signals_teamwork_and_leadership():
    members = [{"user_id": 1, "name": "Student A"}]
    ts = TeamState(team_number=1, topic="AI in Education", members=members)

    # 1. Test Agreement
    _update_chat_signals(ts, user_id=1, text="I absolutely agree with that point, it is very well said!")
    assert ts.agree_disagree_votes[1]["agree"] == 1
    assert ts.agree_disagree_votes[1]["disagree"] == 0

    # 2. Test Disagreement
    _update_chat_signals(ts, user_id=1, text="I differ on this. On the contrary, let's consider another view.")
    assert ts.agree_disagree_votes[1]["disagree"] == 1

    # 3. Test Question
    _update_chat_signals(ts, user_id=1, text="What do you think about this? Is it scalable?")
    assert ts.agree_disagree_votes[1]["questions"] == 1

    # 4. Test Leadership (Summarize / Guide)
    _update_chat_signals(ts, user_id=1, text="In conclusion, to sum up, we should focus on the main topic.")
    assert ts.relevant_points_count[1] == 2  # one for sum up/conclusion, one for guidance/focus
    assert ts.consensus_claimed_by == 1


def test_compute_scores_shared():
    # Verify api/gd_live.py _compute_scores also matches behavior
    mock_eval = MagicMock()
    mock_eval.overall_score = 79.0
    mock_eval.grammar_score = 80.0
    mock_eval.fluency_score = 78.0
    mock_eval.pronunciation_score = 75.0
    mock_eval.confidence_score = 80.0
    mock_eval.vocabulary_score = 77.0
    mock_eval.topic_relevance_score = 82.0
    mock_eval.content_quality_score = 80.0
    mock_eval.weaknesses = ["Grammar errors detected"]
    mock_eval.recommendations = ["Practice tenses"]

    scores = _compute_scores(mock_eval)
    assert scores["overall"] == 79.0
    assert scores["relevance"] == 82.0
    assert scores["quality"] == 80.0
