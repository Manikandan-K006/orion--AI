from backend.ai.confidence import analyze_confidence
from backend.ai.emotion import detect_emotion
from backend.ai.fluency import analyze_fluency
from backend.ai.grammar import analyze_grammar
from backend.ai.pronunciation import analyze_pronunciation
from backend.ai.vocabulary import analyze_vocabulary
from backend.models.schemas import AnalysisResult


def evaluate_transcript(transcript: str, audio_path: str | None = None) -> AnalysisResult:
    grammar = analyze_grammar(transcript)
    pronunciation = analyze_pronunciation(transcript, audio_path)
    fluency = analyze_fluency(transcript)
    confidence = analyze_confidence(transcript)
    vocabulary = analyze_vocabulary(transcript)
    emotion = detect_emotion(transcript)

    overall = round(
        (
            grammar["score"]
            + pronunciation["score"]
            + fluency["score"]
            + confidence["score"]
            + vocabulary["score"]
        )
        / 5,
        2,
    )

    feedback = (
        f"{grammar['message']}. {fluency['message']}. "
        f"{confidence['message']}. {vocabulary['message']}."
    )

    return AnalysisResult(
        grammar_score=grammar["score"],
        pronunciation_score=pronunciation["score"],
        fluency_score=fluency["score"],
        confidence_score=confidence["score"],
        vocabulary_score=vocabulary["score"],
        emotion=emotion["emotion"],
        overall_score=overall,
        feedback=feedback,
    )
