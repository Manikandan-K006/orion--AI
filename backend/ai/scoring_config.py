"""Centralized scoring configuration for all evaluation modes.

Single source of truth for weights, thresholds, and scoring formulas.
All evaluation paths (GD, Solo, GD Live) must import from here.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ScoringWeights:
    """Weights for the overall score formula. Must sum to 1.0."""
    topic_relevance: float = 0.30
    delivery: float = 0.15
    fluency: float = 0.15
    grammar: float = 0.10
    pronunciation: float = 0.10
    confidence: float = 0.10
    vocabulary: float = 0.10


@dataclass(frozen=True)
class RelevanceGating:
    """Score caps when topic relevance is low.

    relevance_floor -> overall_score_cap:
        below 20% relevance -> cap at 35
        below 40% relevance -> cap at 50
        below 60% relevance -> cap at 65
    """
    floor_extreme: float = 20.0
    cap_extreme: float = 35.0
    floor_low: float = 40.0
    cap_low: float = 50.0
    floor_moderate: float = 60.0
    cap_moderate: float = 65.0

    def apply(self, overall: float, relevance_score: float) -> float:
        if relevance_score < self.floor_extreme:
            return min(overall, self.cap_extreme)
        if relevance_score < self.floor_low:
            return min(overall, self.cap_low)
        if relevance_score < self.floor_moderate:
            return min(overall, self.cap_moderate)
        return overall


@dataclass(frozen=True)
class MinimumSpeech:
    """Minimum speech requirements for a valid evaluation."""
    min_words: int = 5
    min_duration_sec: float = 3.0


@dataclass(frozen=True)
class RepetitionPenalty:
    """Penalty config for question repetition / no meaningful content."""
    cap_score: float = 25.0
    content_weight: float = 0.40
    relevance_weight: float = 0.30
    grammar_weight: float = 0.10
    fluency_weight: float = 0.10
    confidence_weight: float = 0.10


GD_WEIGHTS = ScoringWeights()
SOLO_WEIGHTS = ScoringWeights()  # Same formula for solo mode
GD_LIVE_WEIGHTS = ScoringWeights()  # Same formula for GD Live

RELEVANCE_GATING = RelevanceGating()
MINIMUM_SPEECH = MinimumSpeech()
REPETITION_PENALTY = RepetitionPenalty()
