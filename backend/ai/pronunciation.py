from typing import Any


def analyze_pronunciation(transcript: str, audio_path: str | None = None) -> dict[str, Any]:
    word_count = len(transcript.split())
    score = 82 if word_count >= 20 else 68
    return {
        "score": float(score),
        "message": "Pronunciation requires audio analysis; text fallback score used",
    }
