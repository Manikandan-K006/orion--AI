import asyncio
import functools
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Coroutine

from backend.ai.confidence import analyze_confidence
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
    on_progress: ProgressCallback | None = None,
) -> AnalysisResult:
    """Run all 6 AI evaluation modules in parallel using a thread pool.

    Args:
        transcript: The transcribed text to evaluate.
        audio_path: Optional path to audio file (passed to pronunciation module).
        on_progress: Optional async callback called with module name as each completes.
    """
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


def evaluate_transcript(transcript: str, audio_path: str | None = None) -> AnalysisResult:
    """Synchronous wrapper — needed for endpoints that don't use async (classic GD, Solo).

    Internally uses the same parallel execution as evaluate_transcript_parallel.
    """
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
