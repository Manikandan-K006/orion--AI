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
from backend.ai.vocabulary import analyze_vocabulary
from backend.models.schemas import AnalysisResult

_executor = ThreadPoolExecutor(max_workers=4)

MODULE_NAMES = ["grammar", "vocabulary", "fluency", "confidence", "pronunciation", "emotion"]

ProgressCallback = Callable[[str], Coroutine | None]


def _run_module(fn, transcript, audio_path=None):
    if audio_path is not None:
        return fn(transcript, audio_path)
    return fn(transcript)


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

    # Perform Content Quality & Question Repetition Analysis
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
        # Weighted overall score prioritizing Content Quality & Topic Relevance over pure grammar/pronunciation
        overall = round(
            0.25 * content_info["content_quality_score"]
            + 0.20 * content_info["topic_understanding_score"]
            + 0.15 * content_info["topic_relevance_score"]
            + 0.10 * grammar["score"]
            + 0.10 * fluency["score"]
            + 0.10 * confidence["score"]
            + 0.10 * vocabulary["score"],
            1,
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
        topic_understanding_score=content_info["topic_understanding_score"],
        content_quality_score=content_info["content_quality_score"],
        originality_score=content_info["originality_score"],
        critical_thinking_score=content_info["critical_thinking_score"],
        topic_relevance_score=content_info["topic_relevance_score"],
        is_question_repetition=content_info["is_question_repetition"],
        repetition_reason=content_info["repetition_reason"],
        emotion=emotion["emotion"],
        overall_score=overall,
        feedback=feedback,
        strengths=content_info["strengths"],
        weaknesses=content_info["weaknesses"],
        grammar_corrections=content_info["grammar_corrections"],
        pronunciation_suggestions=content_info["pronunciation_suggestions"],
        vocabulary_improvements=content_info["vocabulary_improvements"],
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
        overall = round(
            0.25 * content_info["content_quality_score"]
            + 0.20 * content_info["topic_understanding_score"]
            + 0.15 * content_info["topic_relevance_score"]
            + 0.10 * grammar["score"]
            + 0.10 * fluency["score"]
            + 0.10 * confidence["score"]
            + 0.10 * vocabulary["score"],
            1,
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
        topic_understanding_score=content_info["topic_understanding_score"],
        content_quality_score=content_info["content_quality_score"],
        originality_score=content_info["originality_score"],
        critical_thinking_score=content_info["critical_thinking_score"],
        topic_relevance_score=content_info["topic_relevance_score"],
        is_question_repetition=content_info["is_question_repetition"],
        repetition_reason=content_info["repetition_reason"],
        emotion=emotion["emotion"],
        overall_score=overall,
        feedback=feedback,
        strengths=content_info["strengths"],
        weaknesses=content_info["weaknesses"],
        grammar_corrections=content_info["grammar_corrections"],
        pronunciation_suggestions=content_info["pronunciation_suggestions"],
        vocabulary_improvements=content_info["vocabulary_improvements"],
        missing_discussion_points=content_info["missing_discussion_points"],
        recommendations=content_info["recommendations"],
    )
