import re
from typing import Any


def analyze_grammar(transcript: str) -> dict[str, Any]:
    words = transcript.split()
    sentence_count = max(1, len(re.findall(r"[.!?]", transcript)))
    repeated_words = sum(1 for idx in range(1, len(words)) if words[idx].lower() == words[idx - 1].lower())
    score = max(40, min(100, 92 - repeated_words * 8 - max(0, sentence_count - 8) * 2))
    return {
        "score": float(score),
        "issues": repeated_words,
        "message": "Grammar is clear" if score >= 75 else "Reduce repeated words and review sentence structure",
    }
