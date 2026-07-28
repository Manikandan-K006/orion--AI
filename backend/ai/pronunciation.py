import re
from typing import Any


def analyze_pronunciation(transcript: str, audio_path: str | None = None) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 0.0,
            "message": "No speech content detected.",
            "status": "no_speech",
        }

    words = re.findall(r'\b\w+\b', text.lower())
    if not words:
        return {
            "score": 0.0,
            "message": "No speech content detected.",
            "status": "no_speech",
        }

    total_words = len(words)
    avg_word_len = sum(len(w) for w in words) / total_words
    sentence_count = max(1, len(re.findall(r'[.!?]', text)))
    words_per_sentence = total_words / sentence_count
    long_word_count = sum(1 for w in words if len(w) > 6)

    sentence_score = min(25.0, words_per_sentence * 1.5) if words_per_sentence < 17 else max(10.0, 25.0 - (words_per_sentence - 17) * 0.8)
    vocab_complexity = min(20.0, (long_word_count / max(1, total_words)) * 80)
    length_score = min(15.0, total_words * 0.3)

    pronunciation_score = 20.0 + sentence_score + vocab_complexity + length_score
    pronunciation_score = max(0.0, min(95.0, pronunciation_score))

    if pronunciation_score >= 75:
        message = "Good articulation and sentence variety. Evaluate with audio for pitch/clarity."
    elif pronunciation_score >= 50:
        message = "Moderate articulation complexity. Consider varied sentence structures."
    else:
        message = "Limited vocabulary complexity. Use more polysyllabic words."

    message += " (Text-only approximation; no audio analysis available.)"

    return {
        "score": round(pronunciation_score, 1),
        "message": message,
        "status": "text_fallback",
    }
