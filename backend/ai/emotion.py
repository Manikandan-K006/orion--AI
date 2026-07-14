from typing import Any


def detect_emotion(transcript: str) -> dict[str, Any]:
    text = transcript.lower()
    if any(word in text for word in ["excited", "happy", "confident", "proud"]):
        emotion = "positive"
    elif any(word in text for word in ["nervous", "worried", "afraid", "confused"]):
        emotion = "anxious"
    else:
        emotion = "neutral"
    return {"emotion": emotion}
