import re
from typing import Any

def analyze_grammar(transcript: str) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 10.0,
            "issues": 0,
            "corrections": [],
            "message": "No speech content detected."
        }

    words = text.split()
    total_words = len(words)
    sentence_count = max(1, len(re.findall(r"[.!?]", text)))
    
    corrections = []
    
    # 1. Repeated words ("the the", "is is")
    repeated_words_matches = re.finditer(r"\b(\w+)\s+\1\b", text, re.IGNORECASE)
    for m in repeated_words_matches:
        word = m.group(1)
        corrections.append(f"Duplicated word: '{word} {word}' should be simplified to '{word}'")

    # 2. Article errors
    # "a" followed by vowel sound
    a_vowel_matches = re.finditer(r"\ba\s+(apple|orange|egg|elephant|idea|individual|option|educator|intelligence|algorithm|element|outcome|impact|instance)\b", text, re.IGNORECASE)
    for m in a_vowel_matches:
        corrections.append(f"Incorrect article: '{m.group(0)}' should be 'an {m.group(1)}'")

    # "an" followed by consonant sound
    an_consonant_matches = re.finditer(r"\ban\s+(book|student|teacher|classroom|technology|device|computer|platform|learning|school|university|subject|system|concept)\b", text, re.IGNORECASE)
    for m in an_consonant_matches:
        corrections.append(f"Incorrect article: '{m.group(0)}' should be 'a {m.group(1)}'")

    # 3. Subject-Verb agreement
    sva_matches_1 = re.finditer(r"\b(he|she|it)\s+(have|do|go|want|like|need)\b", text, re.IGNORECASE)
    for m in sva_matches_1:
        subject = m.group(1)
        verb = m.group(2)
        correct_verb = "has" if verb.lower() == "have" else (verb + "es" if verb.lower() in ("do", "go") else verb + "s")
        corrections.append(f"Subject-verb agreement: '{subject} {verb}' should be '{subject} {correct_verb}'")

    sva_matches_2 = re.finditer(r"\b(they|we|you|i)\s+(is)\b", text, re.IGNORECASE)
    for m in sva_matches_2:
        subject = m.group(1)
        verb = m.group(2)
        correct_verb = "am" if subject.lower() == "i" else "are"
        corrections.append(f"Subject-verb agreement: '{subject} {verb}' should be '{subject} {correct_verb}'")

    sva_matches_3 = re.finditer(r"\b(they|we|you)\s+(was)\b", text, re.IGNORECASE)
    for m in sva_matches_3:
        subject = m.group(1)
        corrections.append(f"Subject-verb agreement: '{subject} was' should be '{subject} were'")

    # 4. Plural form mismatches ("many student", "two device")
    plural_mismatches = re.finditer(
        r"\b(many|several|few|two|three|four|five|six|ten|multiple)\s+(student|teacher|child|person|book|device|country|problem|factor|example|reason|point)\b", 
        text, 
        re.IGNORECASE
    )
    for m in plural_mismatches:
        quantifier = m.group(1)
        noun = m.group(2)
        correct_noun = "children" if noun.lower() == "child" else ("people" if noun.lower() == "person" else (noun + "ies" if noun.lower() == "country" else noun + "s"))
        corrections.append(f"Plural mismatch: '{quantifier} {noun}' should be '{quantifier} {correct_noun}'")

    # 5. Preposition mistakes
    prep_errors = [
        (r"\binterested\s+on\b", "interested in"),
        (r"\bdepends\s+of\b", "depends on"),
        (r"\bdiscuss\s+about\b", "discuss"),
        (r"\bcoping\s+up\s+with\b", "coping with"),
    ]
    for pattern, correct in prep_errors:
        matches = re.finditer(pattern, text, re.IGNORECASE)
        for m in matches:
            corrections.append(f"Incorrect phrasing: '{m.group(0)}' should be '{correct}'")

    error_count = len(corrections)
    
    # Calculate Grammar score dynamically
    accuracy = max(20.0, min(100.0, 98.0 - error_count * 7.5))
    
    if error_count == 0:
        message = "Excellent grammatical accuracy with structured sentences."
    elif error_count <= 2:
        message = "Good sentence structure with minimal grammatical errors."
    else:
        message = f"Found {error_count} grammar issues. Review subject-verb agreement and plural forms."

    return {
        "score": float(round(accuracy, 1)),
        "issues": error_count,
        "corrections": corrections,
        "message": message,
    }
