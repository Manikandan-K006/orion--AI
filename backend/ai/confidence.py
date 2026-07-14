def analyze_confidence(transcript: str) -> dict:
    confident_terms = ["led", "built", "created", "improved", "solved", "managed", "designed"]
    hesitant_terms = ["maybe", "probably", "i guess", "not sure"]
    text = transcript.lower()
    positives = sum(1 for term in confident_terms if term in text)
    hesitations = sum(1 for term in hesitant_terms if term in text)
    score = max(45, min(100, 72 + positives * 4 - hesitations * 8))
    return {
        "score": float(score),
        "message": "Confident delivery" if score >= 75 else "Use clearer, more assertive phrasing",
    }
