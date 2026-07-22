import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.ai.evaluation import evaluate_transcript_parallel

async def test():
    transcripts = [
        "",
        "[Audio could not be transcribed clearly]",
        "Hello",
        "Yes I agree.",
    ]
    for t in transcripts:
        try:
            res = await evaluate_transcript_parallel(t)
            print(f"Transcript: '{t}' -> Overall: {res.overall_score}, Grammar: {res.grammar_score}, Fluency: {res.fluency_score}, Confidence: {res.confidence_score}, Vocab: {res.vocabulary_score}")
        except Exception as e:
            print(f"Transcript: '{t}' -> FAILED: {e}")

if __name__ == "__main__":
    asyncio.run(test())
