import re
from typing import Any

CONFIDENT_TERMS = frozenset({
    "definitely", "certainly", "absolutely", "confident", "strong", "clear",
    "substantiate", "demonstrates", "evidence", "propose", "ensure", "guarantee",
    "substantially", "clearly", "convinced", "advocate", "resolve", "decisive",
    "assert", "emphasize", "unquestionably", "undoubtedly", "precisely",
})
HESITANT_TERMS = frozenset({
    "maybe", "probably", "i think", "i guess", "not sure", "perhaps", "might",
    "try", "could", "unsure", "somewhat", "guess", "somehow", "possibly",
    "apparently", "seemingly", "kind of", "sort of",
})
FILLERS = frozenset({"uh", "umm", "um", "like", "actually"})


def analyze_confidence(transcript: str) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 0.0,
            "confident_terms_count": 0,
            "hesitant_terms_count": 0,
            "message": "No speech content detected.",
            "status": "no_speech",
        }

    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)

    positives = sum(1 for w in words if w in CONFIDENT_TERMS)
    hesitations = sum(1 for w in words if w in HESITANT_TERMS)

    ellipsis_count = len(re.findall(r'\.\.\.', text))
    filler_count = sum(1 for w in words if w in FILLERS)
    filler_rate = filler_count / max(1, total_words)

    confidence_score = 55.0
    confidence_score += min(30.0, positives * 4.0)
    confidence_score -= min(35.0, hesitations * 5.5)
    confidence_score -= min(20.0, ellipsis_count * 4.0)
    confidence_score -= min(15.0, filler_rate * 30.0)
    confidence_score = max(0.0, min(100.0, confidence_score))

    if confidence_score >= 75:
        message = "Assertive delivery with strong, decisive language."
    elif confidence_score >= 55:
        message = "Moderately confident; some tentative phrasing detected."
    else:
        message = "Hesitant delivery. Reduce uncertain phrases like 'maybe' and 'I think'."

    return {
        "score": round(confidence_score, 1),
        "confident_terms_count": positives,
        "hesitant_terms_count": hesitations,
        "message": message,
        "status": "ok",
    }
