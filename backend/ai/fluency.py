import re
from typing import Any

def analyze_fluency(transcript: str, audio_path: str | None = None) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 10.0,
            "filler_count": 0,
            "filler_rate": 0.0,
            "speech_speed_wpm": 0,
            "pauses_count": 0,
            "message": "No speech content detected."
        }

    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)
    
    # 1. Filler words
    fillers = ["um", "uh", "like", "actually", "basically", "you know", "hmm", "er"]
    filler_count = sum(1 for w in words if w in fillers)
    filler_rate = round((filler_count / max(1, total_words)) * 100, 1)

    # 2. Pause density & ellipses (indicators of hesitation/long pauses)
    ellipsis_count = len(re.findall(r'\.\.\.', text))
    comma_count = len(re.findall(r',', text))
    period_count = len(re.findall(r'\.', text))
    pauses_count = ellipsis_count * 2 + comma_count + period_count

    # 3. Speech speed (WPM)
    # Deduced speaking duration: each word takes ~0.4s, each ellipsis takes ~1.5s, commas take ~0.6s
    estimated_duration_sec = max(3.0, (total_words * 0.45) + (ellipsis_count * 1.8) + (comma_count * 0.8))
    speech_speed_wpm = int(total_words / (estimated_duration_sec / 60.0))
    # Bound to realistic WPM range
    speech_speed_wpm = min(170, max(50, speech_speed_wpm))

    # Connective/transition phrases indicating high fluency flow
    connectives = {"however", "therefore", "furthermore", "consequently", "specifically", "in addition", "moreover"}
    connective_count = sum(1 for w in words if w in connectives)

    # Calculate Fluency Score
    # Deductions: high filler count, excessive ellipsis/hesitant pauses, too fast/slow speech speed
    speed_factor = 1.0 - (abs(130 - speech_speed_wpm) / 130.0) # peak at 130 WPM
    fluency_score = 60.0 + (speed_factor * 25.0) - (filler_count * 3.5) - (ellipsis_count * 5.0) + (connective_count * 3.0)
    fluency_score = max(20.0, min(100.0, fluency_score))

    if fluency_score >= 85:
        message = "Natural vocal flow with steady tempo and cohesive connectives."
    elif fluency_score >= 70:
        message = "Satisfactory fluency, although minor filler hesitations were observed."
    else:
        message = "Vocal delivery contains frequent filler words and irregular pause gaps."

    return {
        "score": float(round(fluency_score, 1)),
        "filler_count": filler_count,
        "filler_rate": filler_rate,
        "speech_speed_wpm": speech_speed_wpm,
        "pauses_count": pauses_count,
        "message": message
    }
