def analyze_vocabulary(transcript: str) -> dict:
    words = [word.strip(".,!?;:").lower() for word in transcript.split()]
    unique_words = set(words)
    diversity = len(unique_words) / max(1, len(words))
    score = max(50, min(100, 55 + diversity * 45))
    return {
        "score": float(round(score, 2)),
        "unique_words": len(unique_words),
        "message": "Vocabulary variety is good" if score >= 75 else "Add more specific examples and varied words",
    }
