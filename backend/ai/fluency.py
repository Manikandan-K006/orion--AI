import re
from typing import Any

FILLER_WORDS = frozenset({"um", "uh", "erm", "ah", "hmm", "like", "you know", "actually", "basically", "er"})
CONNECTIVES = frozenset({"however", "therefore", "furthermore", "consequently", "specifically", "in addition", "moreover", "thus", "hence", "additionally", "meanwhile"})


def _detect_fillers(words: list[str]) -> tuple[int, list[str]]:
    count = 0
    found: list[str] = []
    for i, w in enumerate(words):
        if w in FILLER_WORDS:
            if w == "like" and i > 0 and i < len(words) - 1:
                prev, nxt = words[i - 1], words[i + 1]
                if prev not in {"i", "she", "he", "it", "we", "they", "you"}:
                    continue
            if w == "actually" and i > 0:
                prev = words[i - 1]
                if prev in {"i", "we", "they", "you", "she", "he"}:
                    continue
            count += 1
            if w not in found:
                found.append(w)
    return count, found


def _estimate_pause_features(transcript: str) -> dict[str, Any]:
    ellipsis_count = len(re.findall(r'\.\.\.', text := transcript))
    comma_count = transcript.count(',')
    period_count = transcript.count('.')
    long_pauses = ellipsis_count
    short_pauses = comma_count
    total_pauses = long_pauses + short_pauses
    return {
        "long_pause_count": long_pauses,
        "short_pause_count": short_pauses,
        "total_pauses": total_pauses,
        "ellipsis_count": ellipsis_count,
    }


def _estimate_wpm(total_words: int, ellipsis_count: int, comma_count: int) -> float:
    estimated_sec = max(3.0, (total_words * 0.45) + (ellipsis_count * 1.8) + (comma_count * 0.8))
    return round(total_words / (estimated_sec / 60.0), 1)


def _count_repeated_words(words: list[str]) -> int:
    repeats = 0
    for i in range(1, len(words)):
        if words[i] == words[i - 1]:
            repeats += 1
    return repeats


def _count_false_starts(transcript: str) -> int:
    return len(re.findall(r'\b(i|i am|i think|i believe|so|well)\s+[,.]?\s+(i|i am|i think|i believe|so|well)\b', transcript.lower()))


def analyze_fluency(transcript: str, audio_path: str | None = None) -> dict[str, Any]:
    text = transcript.strip()
    if not text:
        return {
            "score": 0.0,
            "filler_count": 0,
            "filler_rate": 0.0,
            "fillers_found": [],
            "speech_speed_wpm": 0.0,
            "pauses_count": 0,
            "long_pause_count": 0,
            "repeated_word_count": 0,
            "false_start_count": 0,
            "connective_count": 0,
            "message": "No speech content detected.",
            "status": "no_speech",
        }

    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)

    filler_count, fillers_found = _detect_fillers(words)
    filler_rate = round((filler_count / max(1, total_words)) * 100, 1)

    pause_features = _estimate_pause_features(text)
    long_pause_count = pause_features["long_pause_count"]

    ellipsis_count = pause_features["ellipsis_count"]
    comma_count = text.count(',')
    speech_speed_wpm = _estimate_wpm(total_words, ellipsis_count, comma_count)
    speech_speed_wpm = max(30.0, min(200.0, speech_speed_wpm))

    connective_count = sum(1 for w in words if w in CONNECTIVES)

    repeated_word_count = _count_repeated_words(words)
    false_start_count = _count_false_starts(text)

    wpm_penalty = 0.0
    if speech_speed_wpm < 60:
        wpm_penalty = (60 - speech_speed_wpm) * 0.4
    elif speech_speed_wpm > 160:
        wpm_penalty = (speech_speed_wpm - 160) * 0.3
    speed_factor = 1.0 - min(1.0, abs(120 - speech_speed_wpm) / 120.0)

    fluency_score = 60.0
    fluency_score += speed_factor * 20.0
    fluency_score -= filler_count * 4.0
    fluency_score -= ellipsis_count * 5.0
    fluency_score -= repeated_word_count * 3.0
    fluency_score -= false_start_count * 4.0
    fluency_score += min(15.0, connective_count * 3.0)
    fluency_score -= wpm_penalty
    fluency_score = max(0.0, min(100.0, fluency_score))

    if fluency_score >= 80:
        message = "Natural vocal flow with steady tempo and cohesive connectives."
    elif fluency_score >= 60:
        message = "Satisfactory fluency; some hesitation and filler words observed."
    elif fluency_score >= 40:
        message = "Frequent pauses and filler words reduced speaking continuity."
    else:
        message = "Very low fluency. Significant hesitation, repetition, and broken speech patterns."

    return {
        "score": round(fluency_score, 1),
        "filler_count": filler_count,
        "filler_rate": filler_rate,
        "fillers_found": fillers_found,
        "speech_speed_wpm": speech_speed_wpm,
        "pauses_count": pause_features["total_pauses"],
        "long_pause_count": long_pause_count,
        "repeated_word_count": repeated_word_count,
        "false_start_count": false_start_count,
        "connective_count": connective_count,
        "message": message,
        "status": "ok",
    }
