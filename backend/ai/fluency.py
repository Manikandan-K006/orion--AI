from typing import Any


def analyze_fluency(transcript: str, audio_path: str | None = None) -> dict[str, Any]:
    fillers = ["um", "uh", "like", "actually", "basically", "you know", "i mean"]
    words = transcript.lower().split()
    filler_count = sum(1 for word in words if word.strip(".,!?") in fillers)
    score = max(45, min(100, 88 - filler_count * 6))
    return {
        "score": float(score),
        "filler_count": filler_count,
        "message": "Fluency is steady" if score >= 75 else "Practice reducing filler words and hesitations",
    }
