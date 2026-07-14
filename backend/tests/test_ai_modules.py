"""Tests for AI analysis modules using text-only fallback (no audio)."""

from backend.ai.grammar import analyze_grammar
from backend.ai.fluency import analyze_fluency
from backend.ai.confidence import analyze_confidence
from backend.ai.vocabulary import analyze_vocabulary
from backend.ai.emotion import detect_emotion
from backend.ai.pronunciation import analyze_pronunciation
from backend.ai.evaluation import evaluate_transcript


class TestGrammar:
    def test_returns_float_score(self):
        result = analyze_grammar("I built a project and solved many problems.")
        assert isinstance(result["score"], float)
        assert 0 <= result["score"] <= 100

    def test_clear_grammar_high_score(self):
        result = analyze_grammar("I designed the backend and improved performance.")
        assert result["score"] >= 40

    def test_repeated_words_lower_score(self):
        clean = analyze_grammar("The project was good.")
        repeated = analyze_grammar("The the project was good good.")
        assert repeated["score"] <= clean["score"]


class TestFluency:
    def test_returns_float_score(self):
        result = analyze_fluency("I worked on a team project.")
        assert isinstance(result["score"], float)
        assert 0 <= result["score"] <= 100

    def test_fillers_reduce_score(self):
        no_fillers = analyze_fluency("I led the team effectively.")
        with_fillers = analyze_fluency("Like, um, I led the team, like, effectively.")
        assert with_fillers["score"] <= no_fillers["score"]


class TestConfidence:
    def test_returns_float_score(self):
        result = analyze_confidence("I built a project.")
        assert isinstance(result["score"], float)

    def test_confident_terms_increase_score(self):
        low = analyze_confidence("Maybe I guess I think I did something.")
        high = analyze_confidence("I built and designed and managed the project.")
        assert high["score"] >= low["score"]


class TestVocabulary:
    def test_returns_float_score(self):
        result = analyze_vocabulary("This is a sample transcript.")
        assert isinstance(result["score"], float)

    def test_diverse_words_score(self):
        diverse = analyze_vocabulary("The quick brown fox jumps over the lazy dog near the river bank.")
        assert diverse["score"] > 0


class TestEmotion:
    def test_positive_keywords(self):
        result = detect_emotion("I feel excited and confident about this.")
        assert result["emotion"] == "positive"

    def test_negative_keywords(self):
        result = detect_emotion("I am nervous and worried.")
        assert result["emotion"] == "anxious"

    def test_neutral_fallback(self):
        result = detect_emotion("The sky is blue and the grass is green.")
        assert result["emotion"] in ("neutral",)


class TestPronunciationFallback:
    def test_returns_float_score(self):
        result = analyze_pronunciation("A sample transcript with enough words to measure.")
        assert isinstance(result["score"], float)


class TestEvaluateTranscript:
    def test_returns_analysis_result(self):
        result = evaluate_transcript("I built a final year project where I designed the backend and improved queries.")
        assert hasattr(result, "overall_score")
        assert hasattr(result, "grammar_score")
        assert hasattr(result, "fluency_score")
        assert hasattr(result, "confidence_score")
        assert hasattr(result, "vocabulary_score")
        assert hasattr(result, "pronunciation_score")
        assert hasattr(result, "emotion")
        assert hasattr(result, "feedback")
        assert 0 <= result.overall_score <= 100

    def test_empty_transcript_still_returns(self):
        result = evaluate_transcript("")
        assert result.overall_score >= 0
