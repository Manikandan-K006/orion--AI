import asyncio
import functools
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Coroutine

from backend.ai.confidence import analyze_confidence
from backend.ai.content_analyzer import analyze_content_and_repetition
from backend.ai.emotion import detect_emotion
from backend.ai.fluency import analyze_fluency
from backend.ai.grammar import analyze_grammar
from backend.ai.pronunciation import analyze_pronunciation
from backend.ai.topic_relevance import analyze_topic_relevance
from backend.ai.vocabulary import analyze_vocabulary
from backend.models.schemas import AnalysisResult

_executor = ThreadPoolExecutor(max_workers=4)

MODULE_NAMES = [
    "grammar", "vocabulary", "fluency", "confidence",
    "pronunciation", "emotion", "topic_relevance",
]

ProgressCallback = Callable[[str], Coroutine | None]


def _run_module(fn, transcript, audio_path=None):
    if audio_path is not None:
        return fn(transcript, audio_path)
    return fn(transcript)


def _compute_overall(
    grammar: float,
    fluency: float,
    confidence: float,
    vocabulary: float,
    pronunciation: float,
    content_quality: float,
    topic_relevance: float,
) -> float:
    """GD scoring formula with topic relevance as the dominant weight.

    Weights:
        Topic relevance/content: 30%
        Communication (fluency + confidence + pronunciation combined): 15%
        Fluency: 15%
        Grammar: 10%
        Pronunciation: 10%
        Confidence: 10%
        Vocabulary: 10%
    """
    communication = (fluency * 0.4 + confidence * 0.3 + pronunciation * 0.3)

    overall = round(
        topic_relevance * 0.30
        + communication * 0.15
        + fluency * 0.15
        + grammar * 0.10
        + pronunciation * 0.10
        + confidence * 0.10
        + vocabulary * 0.10,
        1,
    )
    return max(0.0, min(100.0, overall))


def _apply_safeguards(overall: float, relevance_score: float, classification: str) -> float:
    """Enforce score ceilings when topic relevance is low."""
    if classification == "off_topic" or relevance_score < 10:
        return min(overall, 15.0)
    if relevance_score < 30:
        return min(overall, 40.0)
    return overall


async def evaluate_transcript_parallel(
    transcript: str,
    audio_path: str | None = None,
    topic: str = "",
    on_progress: ProgressCallback | None = None,
) -> AnalysisResult:
    """Run AI evaluation modules in parallel and enforce content quality & repetition detection."""
    loop = asyncio.get_running_loop()
    modules = [
        (analyze_grammar, (transcript,), {}, "grammar"),
        (analyze_pronunciation, (transcript, audio_path) if audio_path else (transcript,), {}, "pronunciation"),
        (analyze_fluency, (transcript,), {}, "fluency"),
        (analyze_confidence, (transcript,), {}, "confidence"),
        (analyze_vocabulary, (transcript,), {}, "vocabulary"),
        (detect_emotion, (transcript,), {}, "emotion"),
    ]

    async def run_one(fn, args, kwargs, name):
        result = await loop.run_in_executor(
            _executor, functools.partial(fn, *args, **kwargs)
        )
        if on_progress:
            cb = on_progress(name)
            if cb:
                await cb
        return result

    tasks = [run_one(fn, args, kwargs, name) for fn, args, kwargs, name in modules]
    results = await asyncio.gather(*tasks)
    grammar, pronunciation, fluency, confidence, vocabulary, emotion = results

    # Run topic relevance analysis (CPU-bound, offload to thread)
    relevance_result = await loop.run_in_executor(
        _executor, functools.partial(analyze_topic_relevance, transcript, topic)
    )
    if on_progress:
        cb = on_progress("topic_relevance")
        if cb:
            await cb

    # Run legacy content quality & repetition detection
    content_info = analyze_content_and_repetition(transcript, topic)

    # Compute overall using new relevance-aware formula
    if content_info["is_question_repetition"]:
        overall = min(25.0, round(
            0.40 * content_info["content_quality_score"]
            + 0.30 * content_info["topic_relevance_score"]
            + 0.10 * grammar["score"]
            + 0.10 * fluency["score"]
            + 0.10 * confidence["score"],
            1,
        ))
        feedback = f"CRITICAL NOTICE: Question Repetition / No Meaningful Content. {content_info['repetition_reason']}"
    else:
        overall = _compute_overall(
            grammar=grammar["score"],
            fluency=fluency["score"],
            confidence=confidence["score"],
            vocabulary=vocabulary["score"],
            pronunciation=pronunciation["score"],
            content_quality=relevance_result["content_quality_score"],
            topic_relevance=relevance_result["relevance_score"],
        )
        # Apply score safeguards
        overall = _apply_safeguards(
            overall,
            relevance_result["relevance_score"],
            relevance_result["classification"],
        )

        feedback_parts = [relevance_result["feedback"]]
        feedback_parts.append(grammar["message"])
        feedback_parts.append(fluency["message"])
        feedback_parts.append(confidence["message"])
        feedback_parts.append(vocabulary["message"])
        feedback = ". ".join(feedback_parts)

    return AnalysisResult(
        grammar_score=grammar["score"],
        pronunciation_score=pronunciation["score"],
        fluency_score=fluency["score"],
        confidence_score=confidence["score"],
        vocabulary_score=vocabulary["score"],
        topic_understanding_score=content_info["topic_understanding_score"],
        content_quality_score=relevance_result["content_quality_score"],
        originality_score=content_info["originality_score"],
        critical_thinking_score=content_info["critical_thinking_score"],
        topic_relevance_score=relevance_result["relevance_score"],
        is_question_repetition=content_info["is_question_repetition"],
        repetition_reason=content_info["repetition_reason"],
        emotion=emotion["emotion"],
        overall_score=overall,
        feedback=feedback,
        strengths=content_info["strengths"] or [relevance_result["feedback"]],
        weaknesses=content_info["weaknesses"],
        grammar_corrections=grammar.get("corrections", []),
        pronunciation_suggestions=pronunciation.get("corrections", []) or pronunciation.get("suggestions", []),
        vocabulary_improvements=vocabulary.get("vocabulary_improvements", []),
        missing_discussion_points=content_info["missing_discussion_points"],
        recommendations=content_info["recommendations"],
    )


def evaluate_transcript(transcript: str, audio_path: str | None = None, topic: str = "") -> AnalysisResult:
    """Synchronous evaluation wrapper."""
    grammar = analyze_grammar(transcript)
    pronunciation = analyze_pronunciation(transcript, audio_path)
    fluency = analyze_fluency(transcript)
    confidence = analyze_confidence(transcript)
    vocabulary = analyze_vocabulary(transcript)
    emotion = detect_emotion(transcript)
    relevance_result = analyze_topic_relevance(transcript, topic)
    content_info = analyze_content_and_repetition(transcript, topic)

    if content_info["is_question_repetition"]:
        overall = min(25.0, round(
            0.40 * content_info["content_quality_score"]
            + 0.30 * content_info["topic_relevance_score"]
            + 0.10 * grammar["score"]
            + 0.10 * fluency["score"]
            + 0.10 * confidence["score"],
            1,
        ))
        feedback = f"CRITICAL NOTICE: Question Repetition / No Meaningful Content. {content_info['repetition_reason']}"
    else:
        overall = _compute_overall(
            grammar=grammar["score"],
            fluency=fluency["score"],
            confidence=confidence["score"],
            vocabulary=vocabulary["score"],
            pronunciation=pronunciation["score"],
            content_quality=relevance_result["content_quality_score"],
            topic_relevance=relevance_result["relevance_score"],
        )
        overall = _apply_safeguards(
            overall,
            relevance_result["relevance_score"],
            relevance_result["classification"],
        )
        feedback_parts = [relevance_result["feedback"]]
        feedback_parts.append(grammar["message"])
        feedback_parts.append(fluency["message"])
        feedback_parts.append(confidence["message"])
        feedback_parts.append(vocabulary["message"])
        feedback = ". ".join(feedback_parts)

    return AnalysisResult(
        grammar_score=grammar["score"],
        pronunciation_score=pronunciation["score"],
        fluency_score=fluency["score"],
        confidence_score=confidence["score"],
        vocabulary_score=vocabulary["score"],
        topic_understanding_score=content_info["topic_understanding_score"],
        content_quality_score=relevance_result["content_quality_score"],
        originality_score=content_info["originality_score"],
        critical_thinking_score=content_info["critical_thinking_score"],
        topic_relevance_score=relevance_result["relevance_score"],
        is_question_repetition=content_info["is_question_repetition"],
        repetition_reason=content_info["repetition_reason"],
        emotion=emotion["emotion"],
        overall_score=overall,
        feedback=feedback,
        strengths=content_info["strengths"] or [relevance_result["feedback"]],
        weaknesses=content_info["weaknesses"],
        grammar_corrections=grammar.get("corrections", []),
        pronunciation_suggestions=pronunciation.get("corrections", []) or pronunciation.get("suggestions", []),
        vocabulary_improvements=vocabulary.get("vocabulary_improvements", []),
        missing_discussion_points=content_info["missing_discussion_points"],
        recommendations=content_info["recommendations"],
    )
