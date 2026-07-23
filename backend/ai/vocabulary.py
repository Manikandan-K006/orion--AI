import re
from typing import Any

def analyze_vocabulary(transcript: str) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 10.0,
            "unique_words": 0,
            "advanced_vocab_count": 0,
            "lexical_richness": 0.0,
            "vocabulary_improvements": ["Speak for a longer duration to demonstrate vocabulary variety."],
            "message": "No speech content detected."
        }

    words = [word.strip(".,!?;:").lower() for word in text.split() if word.strip(".,!?;:")]
    total_words = len(words)
    unique_words = set(words)
    unique_count = len(unique_words)
    
    lexical_richness = round(unique_count / max(1, total_words), 3)

    # Academic/Advanced Vocabulary list
    advanced_list = {
        "transforming", "transform", "adaptive", "substantiate", "implications", "personalized", "paradigm", 
        "detrimental", "consequently", "furthermore", "mitigate", "leverage", "optimization", "dynamic", 
        "fundamental", "inevitable", "automated", "perspective", "implements", "substantial", "subsequently",
        "beneficial", "technological", "collaborative", "enhances", "facilitates", "integration", "challenges",
        "critical", "analyzes", "improves", "efficiency", "ecosystem", "infrastructure", "implications"
    }
    
    advanced_found = [w for w in words if w in advanced_list]
    advanced_count = len(advanced_found)
    
    # Basic/Simple Vocabulary check
    basic_list = {"good", "bad", "nice", "thing", "do", "make", "go", "say", "get", "like", "also", "very", "big", "small"}
    basic_found = [w for w in words if w in basic_list]
    basic_repeats = {}
    for w in basic_found:
        basic_repeats[w] = basic_repeats.get(w, 0) + 1
    
    repeats_penalty = sum(max(0, count - 2) * 2.5 for count in basic_repeats.values())

    # Dynamic Vocabulary Score
    vocab_score = max(20.0, min(100.0, 50.0 + (lexical_richness * 40.0) + (advanced_count * 4.5) - repeats_penalty))

    improvements = []
    if advanced_count < 2:
        improvements.append("Use domain-specific verbs like 'mitigates', 'leverages', 'accelerates' instead of simple verbs.")
    if repeats_penalty > 5:
        improvements.append("Avoid repeating simple adjectives such as 'good', 'very', or 'nice'. Use varied synonyms.")

    if vocab_score >= 85:
        message = "Excellent lexical variety with domain-specific terminology."
    elif vocab_score >= 70:
        message = "Satisfactory vocabulary variety; could incorporate more analytical descriptors."
    else:
        message = "Vocabulary is simple and repetitive. Incorporate complex academic terms."

    return {
        "score": float(round(vocab_score, 1)),
        "unique_words": unique_count,
        "advanced_vocab_count": advanced_count,
        "lexical_richness": float(round(lexical_richness * 100, 1)),
        "vocabulary_improvements": improvements,
        "message": message
    }
