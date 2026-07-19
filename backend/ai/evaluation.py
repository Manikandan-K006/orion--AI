import asyncio
import functools
from concurrent.futures import ThreadPoolExecutor

from backend.ai.confidence import analyze_confidence
from backend.ai.emotion import detect_emotion
from backend.ai.fluency import analyze_fluency
from backend.ai.grammar import analyze_grammar
from backend.ai.pronunciation import analyze_pronunciation
from backend.ai.vocabulary import analyze_vocabulary
from backend.models.schemas import AnalysisResult

_executor = ThreadPoolExecutor(max_workers=4)


def _run_module(fn, transcript, audio_path=None):
    if audio_path is not None:
        return fn(transcript, audio_path)
    return fn(transcript)


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


async def evaluate_transcript_parallel(transcript: str, audio_path: str | None = None) -> AnalysisResult:
    """Run all 6 AI evaluation modules in parallel using a thread pool."""
    loop = asyncio.get_running_loop()
    modules = [
        (analyze_grammar, (transcript,), {}),
        (analyze_pronunciation, (transcript, audio_path) if audio_path else (transcript,), {}),
        (analyze_fluency, (transcript,), {}),
        (analyze_confidence, (transcript,), {}),
        (analyze_vocabulary, (transcript,), {}),
        (detect_emotion, (transcript,), {}),
    ]
    tasks = [
        loop.run_in_executor(_executor, functools.partial(fn, *args, **kwargs))
        for fn, args, kwargs in modules
    ]
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
