import re
from typing import Any

def analyze_confidence(transcript: str) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 10.0,
            "message": "No speech content detected."
        }

    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)

    confident_terms = {
        "definitely", "certainly", "absolutely", "confident", "strong", "clear", 
        "substantiate", "demonstrates", "evidence", "propose", "ensure", "guarantee", 
        "substantially", "clearly", "convinced", "advocate", "resolve", "decisive"
    }
    hesitant_terms = {
        "maybe", "probably", "i think", "i guess", "not sure", "perhaps", "might", 
        "try", "could", "unsure", "somewhat", "guess", "somehow"
    }

    positives = sum(1 for w in words if w in confident_terms)
    hesitations = sum(1 for w in words if w in hesitant_terms)
    
    # Check for hesitant sentence endings or ellipsis
    ellipsis_count = len(re.findall(r'\.\.\.', text))
    
    # Check for filler word rate
    fillers = ["uh", "umm", "um", "like", "actually"]
    filler_count = sum(1 for w in words if w in fillers)
    filler_rate = filler_count / max(1, total_words)

    # Dynamic Confidence Score:
    # Starts at a balanced 72.0, gains points for assertive vocabulary, loses points for hesitancy indicators
    confidence_score = 72.0 + (positives * 4.0) - (hesitations * 5.5) - (ellipsis_count * 4.0) - (filler_rate * 30.0)
    confidence_score = max(20.0, min(100.0, confidence_score))

    if confidence_score >= 85:
        message = "Highly assertive and convincing speech structure with strong delivery markers."
    elif confidence_score >= 70:
        message = "Moderately confident; could replace tentative phrasing with more decisive statements."
    else:
        message = "Delivery sounds hesitant. Reduce search terms like 'maybe' and 'I think'."

    return {
        "score": float(round(confidence_score, 1)),
        "message": message
    }
