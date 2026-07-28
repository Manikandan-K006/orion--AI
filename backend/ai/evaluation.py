import asyncio
import re
import functools
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Coroutine

from backend.ai.confidence import analyze_confidence
from backend.ai.content_analyzer import analyze_content_and_repetition
from backend.ai.delivery import analyze_delivery
from backend.ai.emotion import detect_emotion
from backend.ai.fluency import analyze_fluency
from backend.ai.grammar import analyze_grammar
from backend.ai.pronunciation import analyze_pronunciation
from backend.ai.topic_relevance import analyze_topic_relevance
from backend.ai.vocabulary import analyze_vocabulary
from backend.ai.scoring_config import (
    GD_WEIGHTS,
    RELEVANCE_GATING,
    MINIMUM_SPEECH,
    REPETITION_PENALTY,
    ScoringWeights,
)
from backend.models.schemas import AnalysisResult

_executor = ThreadPoolExecutor(max_workers=4)

MODULE_NAMES = [
    "grammar", "vocabulary", "fluency", "confidence",
    "pronunciation", "emotion", "topic_relevance", "delivery",
]

ProgressCallback = Callable[[str], Coroutine | None]


def _word_count(transcript: str) -> int:
    return len(re.findall(r'\b\w+\b', transcript.lower()))


def _estimate_duration_sec(word_count: int, transcript: str) -> float:
    ellipsis_count = len(re.findall(r'\.\.\.', transcript))
    comma_count = transcript.count(',')
    return max(3.0, (word_count * 0.45) + (ellipsis_count * 1.8) + (comma_count * 0.8))


def _validate_minimum_speech(transcript: str) -> str | None:
    """Return error message if speech is too short, else None."""
    text = transcript.strip()
    if not text:
        return "no_speech"
    wc = _word_count(text)
    if wc < MINIMUM_SPEECH.min_words:
        return "insufficient_speech"
    return None


def _compute_overall(
    grammar: float,
    fluency: float,
    confidence: float,
    vocabulary: float,
    pronunciation: float,
    delivery: float,
    topic_relevance: float,
    weights: ScoringWeights = GD_WEIGHTS,
) -> float:
    """Weighted overall score using centralized config."""
    overall = round(
        topic_relevance * weights.topic_relevance
        + delivery * weights.delivery
        + fluency * weights.fluency
        + grammar * weights.grammar
        + pronunciation * weights.pronunciation
        + confidence * weights.confidence
        + vocabulary * weights.vocabulary,
        1,
    )
    return max(0.0, min(100.0, overall))


def _apply_relevance_gating(overall: float, relevance_score: float) -> float:
    """Enforce score ceilings based on topic relevance."""
    return RELEVANCE_GATING.apply(overall, relevance_score)


def _aggregate_module_status(*statuses: str) -> str:
    """Return worst-case status across all modules."""
    VALID_STATUSES = {"ok", "text_fallback", "highly_relevant", "relevant", "partially_relevant", "mostly_off_topic", "off_topic"}
    if any(s == "no_speech" for s in statuses):
        return "no_speech"
    if any(s == "insufficient_speech" for s in statuses):
        return "insufficient_speech"
    if any(s not in VALID_STATUSES for s in statuses):
        return "partial_failure"
    return "ok"


def _build_result(
    *,
    grammar: dict,
    fluency: dict,
    confidence: dict,
    vocabulary: dict,
    pronunciation: dict,
    emotion: dict,
    relevance_result: dict,
    content_info: dict,
    delivery_result: dict,
    overall: float,
    feedback: str,
    word_count: int,
    speech_duration_sec: float,
    transcript: str,
) -> AnalysisResult:
    """Construct an AnalysisResult from module outputs."""
    wpm = fluency.get("speech_speed_wpm", 0.0)
    filler_count = fluency.get("filler_count", 0)
    long_pause_count = fluency.get("long_pause_count", 0)

    eval_status = _aggregate_module_status(
        grammar.get("status", "ok"),
        fluency.get("status", "ok"),
        confidence.get("status", "ok"),
        vocabulary.get("status", "ok"),
        pronunciation.get("status", "ok"),
        relevance_result.get("classification", "ok"),
        delivery_result.get("status", "ok"),
    )

    status_detail = ""
    if eval_status == "no_speech":
        status_detail = "No speech content detected in transcript."
    elif eval_status == "insufficient_speech":
        status_detail = f"Only {word_count} word(s) detected; minimum {MINIMUM_SPEECH.min_words} required."
    elif eval_status == "partial_failure":
        failed = []
        for name, data in [
            ("grammar", grammar), ("fluency", fluency), ("confidence", confidence),
            ("vocabulary", vocabulary), ("pronunciation", pronunciation),
            ("delivery", delivery_result),
        ]:
            s = data.get("status", "ok")
            if s not in ("ok", "text_fallback"):
                failed.append(f"{name}={s}")
        status_detail = f"Modules with issues: {', '.join(failed)}"

    return AnalysisResult(
        grammar_score=grammar["score"],
        pronunciation_score=pronunciation["score"],
        fluency_score=fluency["score"],
        confidence_score=confidence["score"],
        vocabulary_score=vocabulary["score"],
        delivery_score=delivery_result["score"],
        topic_relevance_score=relevance_result["relevance_score"],
        content_quality_score=relevance_result["content_quality_score"],
        topic_understanding_score=content_info["topic_understanding_score"],
        originality_score=content_info["originality_score"],
        critical_thinking_score=content_info["critical_thinking_score"],
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
        evaluation_status=eval_status,
        evaluation_status_detail=status_detail,
        word_count=word_count,
        speech_duration_sec=round(speech_duration_sec, 1),
        wpm=wpm,
        filler_count=filler_count,
        long_pause_count=long_pause_count,
        grammar_status=grammar.get("status", "ok"),
        fluency_status=fluency.get("status", "ok"),
        delivery_status=delivery_result.get("status", "ok"),
        relevance_status=relevance_result.get("classification", "ok"),
        pronunciation_status=pronunciation.get("status", "ok"),
        vocabulary_status=vocabulary.get("status", "ok"),
        content_status="repetition" if content_info["is_question_repetition"] else "ok",
    )


async def evaluate_transcript_parallel(
    transcript: str,
    audio_path: str | None = None,
    topic: str = "",
    weights: ScoringWeights = GD_WEIGHTS,
    on_progress: ProgressCallback | None = None,
) -> AnalysisResult:
    """Run AI evaluation modules in parallel and enforce content quality & repetition detection.

    Pipeline:
        1. Validate minimum speech
        2. Run grammar, pronunciation, fluency, confidence, vocabulary, emotion in parallel
        3. Run topic relevance, content analysis, delivery sequentially (depend on fluency/confidence)
        4. Compute weighted overall score
        5. Apply relevance gating
        6. Handle repetition penalty
        7. Build final AnalysisResult with all metadata
    """
    # --- Step 1: Validate minimum speech ---
    word_count = _word_count(transcript)
    speech_duration = _estimate_duration_sec(word_count, transcript)
    speech_status = _validate_minimum_speech(transcript)

    if speech_status:
        return AnalysisResult(
            grammar_score=0.0,
            pronunciation_score=0.0,
            fluency_score=0.0,
            confidence_score=0.0,
            vocabulary_score=0.0,
            delivery_score=0.0,
            topic_relevance_score=0.0,
            content_quality_score=0.0,
            topic_understanding_score=0.0,
            originality_score=0.0,
            critical_thinking_score=0.0,
            is_question_repetition=True,
            repetition_reason="No usable speech content." if speech_status == "no_speech" else f"Only {word_count} word(s); minimum {MINIMUM_SPEECH.min_words} required.",
            emotion="neutral",
            overall_score=0.0,
            feedback="No usable speech content detected." if speech_status == "no_speech" else "Speech too short to evaluate meaningfully.",
            strengths=[],
            weaknesses=["No speech content provided." if speech_status == "no_speech" else "Speech too short to evaluate."],
            evaluation_status=speech_status,
            evaluation_status_detail="No speech content detected." if speech_status == "no_speech" else f"Only {word_count} word(s) detected; minimum {MINIMUM_SPEECH.min_words} required.",
            word_count=word_count,
            speech_duration_sec=round(speech_duration, 1),
            wpm=0.0,
            filler_count=0,
            long_pause_count=0,
        )

    # --- Step 2: Run core modules in parallel ---
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

    # --- Step 3: Topic relevance (CPU-bound) ---
    relevance_result = await loop.run_in_executor(
        _executor, functools.partial(analyze_topic_relevance, transcript, topic)
    )
    if on_progress:
        cb = on_progress("topic_relevance")
        if cb:
            await cb

    # --- Step 4: Content analysis ---
    content_info = analyze_content_and_repetition(transcript, topic)

    # --- Step 5: Delivery (uses fluency + confidence outputs) ---
    delivery_result = analyze_delivery(
        transcript, audio_path, fluency_data=fluency, confidence_data=confidence
    )
    if on_progress:
        cb = on_progress("delivery")
        if cb:
            await cb

    # --- Step 6: Compute overall score ---
    if content_info["is_question_repetition"]:
        overall = min(
            REPETITION_PENALTY.cap_score,
            round(
                REPETITION_PENALTY.content_weight * content_info["content_quality_score"]
                + REPETITION_PENALTY.relevance_weight * content_info["topic_relevance_score"]
                + REPETITION_PENALTY.grammar_weight * grammar["score"]
                + REPETITION_PENALTY.fluency_weight * fluency["score"]
                + REPETITION_PENALTY.confidence_weight * confidence["score"],
                1,
            ),
        )
        feedback = f"CRITICAL NOTICE: Question Repetition / No Meaningful Content. {content_info['repetition_reason']}"
    else:
        overall = _compute_overall(
            grammar=grammar["score"],
            fluency=fluency["score"],
            confidence=confidence["score"],
            vocabulary=vocabulary["score"],
            pronunciation=pronunciation["score"],
            delivery=delivery_result["score"],
            topic_relevance=relevance_result["relevance_score"],
            weights=weights,
        )
        overall = _apply_relevance_gating(overall, relevance_result["relevance_score"])

        feedback_parts = [relevance_result["feedback"]]
        feedback_parts.append(grammar["message"])
        feedback_parts.append(fluency["message"])
        feedback_parts.append(confidence["message"])
        feedback_parts.append(vocabulary["message"])
        feedback_parts.append(delivery_result["message"])
        feedback = ". ".join(feedback_parts)

    # --- Step 7: Build result ---
    return _build_result(
        grammar=grammar,
        fluency=fluency,
        confidence=confidence,
        vocabulary=vocabulary,
        pronunciation=pronunciation,
        emotion=emotion,
        relevance_result=relevance_result,
        content_info=content_info,
        delivery_result=delivery_result,
        overall=overall,
        feedback=feedback,
        word_count=word_count,
        speech_duration_sec=speech_duration,
        transcript=transcript,
    )


def evaluate_transcript(
    transcript: str,
    audio_path: str | None = None,
    topic: str = "",
    weights: ScoringWeights = GD_WEIGHTS,
) -> AnalysisResult:
    """Synchronous evaluation wrapper (for non-async callers)."""
    # --- Validate minimum speech ---
    word_count = _word_count(transcript)
    speech_duration = _estimate_duration_sec(word_count, transcript)
    speech_status = _validate_minimum_speech(transcript)

    if speech_status:
        return AnalysisResult(
            grammar_score=0.0,
            pronunciation_score=0.0,
            fluency_score=0.0,
            confidence_score=0.0,
            vocabulary_score=0.0,
            delivery_score=0.0,
            topic_relevance_score=0.0,
            content_quality_score=0.0,
            topic_understanding_score=0.0,
            originality_score=0.0,
            critical_thinking_score=0.0,
            is_question_repetition=True,
            repetition_reason="No usable speech content." if speech_status == "no_speech" else f"Only {word_count} word(s); minimum {MINIMUM_SPEECH.min_words} required.",
            emotion="neutral",
            overall_score=0.0,
            feedback="No usable speech content detected." if speech_status == "no_speech" else "Speech too short to evaluate meaningfully.",
            strengths=[],
            weaknesses=["No speech content provided." if speech_status == "no_speech" else "Speech too short to evaluate."],
            evaluation_status=speech_status,
            evaluation_status_detail="No speech content detected." if speech_status == "no_speech" else f"Only {word_count} word(s) detected; minimum {MINIMUM_SPEECH.min_words} required.",
            word_count=word_count,
            speech_duration_sec=round(speech_duration, 1),
            wpm=0.0,
            filler_count=0,
            long_pause_count=0,
        )

    # --- Run all modules ---
    grammar = analyze_grammar(transcript)
    pronunciation = analyze_pronunciation(transcript, audio_path)
    fluency = analyze_fluency(transcript)
    confidence = analyze_confidence(transcript)
    vocabulary = analyze_vocabulary(transcript)
    emotion = detect_emotion(transcript)
    relevance_result = analyze_topic_relevance(transcript, topic)
    content_info = analyze_content_and_repetition(transcript, topic)
    delivery_result = analyze_delivery(
        transcript, audio_path, fluency_data=fluency, confidence_data=confidence
    )

    # --- Compute overall ---
    if content_info["is_question_repetition"]:
        overall = min(
            REPETITION_PENALTY.cap_score,
            round(
                REPETITION_PENALTY.content_weight * content_info["content_quality_score"]
                + REPETITION_PENALTY.relevance_weight * content_info["topic_relevance_score"]
                + REPETITION_PENALTY.grammar_weight * grammar["score"]
                + REPETITION_PENALTY.fluency_weight * fluency["score"]
                + REPETITION_PENALTY.confidence_weight * confidence["score"],
                1,
            ),
        )
        feedback = f"CRITICAL NOTICE: Question Repetition / No Meaningful Content. {content_info['repetition_reason']}"
    else:
        overall = _compute_overall(
            grammar=grammar["score"],
            fluency=fluency["score"],
            confidence=confidence["score"],
            vocabulary=vocabulary["score"],
            pronunciation=pronunciation["score"],
            delivery=delivery_result["score"],
            topic_relevance=relevance_result["relevance_score"],
            weights=weights,
        )
        overall = _apply_relevance_gating(overall, relevance_result["relevance_score"])

        feedback_parts = [relevance_result["feedback"]]
        feedback_parts.append(grammar["message"])
        feedback_parts.append(fluency["message"])
        feedback_parts.append(confidence["message"])
        feedback_parts.append(vocabulary["message"])
        feedback_parts.append(delivery_result["message"])
        feedback = ". ".join(feedback_parts)

    return _build_result(
        grammar=grammar,
        fluency=fluency,
        confidence=confidence,
        vocabulary=vocabulary,
        pronunciation=pronunciation,
        emotion=emotion,
        relevance_result=relevance_result,
        content_info=content_info,
        delivery_result=delivery_result,
        overall=overall,
        feedback=feedback,
        word_count=word_count,
        speech_duration_sec=speech_duration,
        transcript=transcript,
    )
