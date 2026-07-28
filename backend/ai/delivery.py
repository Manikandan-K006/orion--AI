import re
from typing import Any


def analyze_delivery(
    transcript: str,
    audio_path: str | None = None,
    fluency_data: dict | None = None,
    confidence_data: dict | None = None,
) -> dict[str, Any]:
    """Evaluate HOW the student spoke using available audio/transcript cues.

    Delivery measures: speaking pace, pause behavior, speech continuity,
    hesitation, clarity. Does NOT derive from grammar or transcript semantics.
    """
    text = transcript.strip()
    if not text:
        return {
            "score": 0.0,
            "speaking_pace": "none",
            "pause_behavior": "none",
            "continuity": "none",
            "hesitation_level": "none",
            "message": "No speech content detected.",
            "status": "no_speech",
        }

    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)

    wpm = fluency_data.get("speech_speed_wpm", 0.0) if fluency_data else 0.0
    filler_count = fluency_data.get("filler_count", 0) if fluency_data else 0
    long_pause_count = fluency_data.get("long_pause_count", 0) if fluency_data else 0
    repeated_words = fluency_data.get("repeated_word_count", 0) if fluency_data else 0
    false_starts = fluency_data.get("false_start_count", 0) if fluency_data else 0
    connectives = fluency_data.get("connective_count", 0) if fluency_data else 0

    confidence_score = confidence_data.get("score", 50.0) if confidence_data else 50.0

    pace_score = 0.0
    if 80 <= wpm <= 150:
        pace_score = 30.0
    elif 60 <= wpm < 80 or 150 < wpm <= 170:
        pace_score = 20.0
    elif 40 <= wpm < 60 or 170 < wpm <= 200:
        pace_score = 10.0
    else:
        pace_score = 0.0

    pause_score = 30.0
    pause_score -= long_pause_count * 5.0
    pause_score -= filler_count * 2.0
    pause_score = max(0.0, min(30.0, pause_score))

    continuity_score = 20.0
    continuity_score -= repeated_words * 3.0
    continuity_score -= false_starts * 4.0
    continuity_score += min(8.0, connectives * 2.0)
    continuity_score = max(0.0, min(20.0, continuity_score))

    hesitation_score = 20.0
    if filler_count == 0 and long_pause_count == 0:
        hesitation_score = 20.0
    elif filler_count <= 2 and long_pause_count <= 1:
        hesitation_score = 15.0
    elif filler_count <= 5 and long_pause_count <= 3:
        hesitation_score = 10.0
    else:
        hesitation_score = max(0.0, 20.0 - filler_count * 2.0 - long_pause_count * 3.0)

    delivery_score = pace_score + pause_score + continuity_score + hesitation_score
    delivery_score = max(0.0, min(100.0, delivery_score))

    pace_label = "optimal" if 80 <= wpm <= 150 else ("slow" if wpm < 80 else "fast")
    pause_label = "minimal" if long_pause_count <= 1 else ("moderate" if long_pause_count <= 3 else "excessive")
    continuity_label = "smooth" if (repeated_words + false_starts) <= 2 else "disrupted"
    hesitation_label = "confident" if (filler_count + long_pause_count) <= 2 else ("moderate" if (filler_count + long_pause_count) <= 5 else "high")

    if delivery_score >= 70:
        message = "Good delivery with appropriate pace and minimal hesitation."
    elif delivery_score >= 50:
        message = "Moderate delivery. Some pauses and filler words affected flow."
    else:
        message = "Delivery needs improvement. Reduce fillers, pauses, and repetitions."

    return {
        "score": round(delivery_score, 1),
        "pace_score": round(pace_score, 1),
        "pause_score": round(pause_score, 1),
        "continuity_score": round(continuity_score, 1),
        "hesitation_score": round(hesitation_score, 1),
        "speaking_pace": pace_label,
        "pause_behavior": pause_label,
        "continuity": continuity_label,
        "hesitation_level": hesitation_label,
        "message": message,
        "status": "ok",
    }
