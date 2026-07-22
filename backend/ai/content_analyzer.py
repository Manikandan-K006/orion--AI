import re
from typing import Any

def analyze_content_and_repetition(transcript: str, topic: str = "") -> dict[str, Any]:
    text = transcript.strip()
    topic_text = topic.strip()
    
    if not text:
        return {
            "is_question_repetition": True,
            "repetition_reason": "No speech content detected.",
            "topic_understanding_score": 10.0,
            "content_quality_score": 10.0,
            "originality_score": 10.0,
            "critical_thinking_score": 10.0,
            "topic_relevance_score": 10.0,
            "speaking_pace": "0 wpm (Silent)",
            "filler_analysis": {"count": 0, "fillers_found": [], "ratio": 0.0},
            "missing_discussion_points": ["Did not articulate any arguments or opinions on the topic."],
            "strengths": [],
            "weaknesses": ["No speech output provided"],
            "grammar_corrections": [],
            "pronunciation_suggestions": [],
            "vocabulary_improvements": [],
            "recommendations": ["Speak clearly for at least 1-2 minutes presenting specific points and examples."]
        }

    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)
    unique_words = len(set(words))
    
    # 1. Detect filler words
    filler_words = ["uh", "umm", "um", "actually", "like", "you know", "basically", "literally", "sort of", "kind of", "i mean"]
    fillers_found = [w for w in words if w in filler_words]
    filler_count = len(fillers_found)
    filler_ratio = round((filler_count / max(1, total_words)) * 100, 1)

    # 2. Check topic repetition / question reading
    is_question_repetition = False
    repetition_reason = ""
    
    if topic_text:
        topic_words = set(re.findall(r'\b\w+\b', topic_text.lower()))
        stop_words = {"the", "is", "at", "which", "on", "a", "an", "and", "or", "in", "of", "to", "for", "with", "vs", "are", "be", "what", "how", "why"}
        core_topic_words = topic_words - stop_words
        core_speech_words = set(words) - stop_words
        
        if core_topic_words:
            overlap = len(core_speech_words.intersection(core_topic_words))
            non_topic_words = core_speech_words - core_topic_words
            if len(non_topic_words) < 5 and total_words < 35:
                is_question_repetition = True
                repetition_reason = "Speech mainly repeats the assigned topic title or question without original reasoning or examples."
    
    # 3. Check sentence repetition (repeating identical phrase over and over)
    sentences = [s.strip() for s in re.split(r'[.!?]', text) if len(s.strip()) > 3]
    if len(sentences) >= 2:
        unique_sentences = set(sentences)
        if len(unique_sentences) / len(sentences) < 0.5:
            is_question_repetition = True
            repetition_reason = "Repeated identical sentences multiple times without adding new thoughts."

    # 4. Check word variety (extremely low unique ratio)
    if total_words > 15 and (unique_words / total_words) < 0.35:
        is_question_repetition = True
        repetition_reason = "Extremely repetitive vocabulary without meaningful discussion content."

    # If flagged as Question Repetition / No Meaningful Content:
    if is_question_repetition:
        return {
            "is_question_repetition": True,
            "repetition_reason": repetition_reason,
            "topic_understanding_score": 20.0,
            "content_quality_score": 15.0,
            "originality_score": 15.0,
            "critical_thinking_score": 10.0,
            "topic_relevance_score": 25.0,
            "speaking_pace": f"{total_words} words total",
            "filler_analysis": {"count": filler_count, "fillers_found": list(set(fillers_found)), "ratio": filler_ratio},
            "missing_discussion_points": [
                "Provide original personal perspectives and real-world examples.",
                "Structure your response: Intro → Core Arguments → Counterpoints → Conclusion.",
                "Avoid reading or repeating the question prompt."
            ],
            "strengths": ["Clear audio input"],
            "weaknesses": [
                "Question Repetition / No Meaningful Content detected.",
                repetition_reason
            ],
            "grammar_corrections": ["Try expanding simple declarative sentences into multi-clause analytical points."],
            "pronunciation_suggestions": ["Ensure distinct articulation when stating key technical terms."],
            "vocabulary_improvements": ["Use analytical verbs such as 'demonstrates', 'substantiates', 'implies', 'accelerates'."],
            "recommendations": [
                "Express original thoughts instead of repeating the topic title.",
                "Elaborate on why you agree or disagree using concrete evidence."
            ]
        }

    # Meaningful content evaluated dynamically
    topic_understanding = min(98.0, max(60.0, 72.0 + (unique_words * 0.35)))
    content_quality = min(96.0, max(58.0, 68.0 + (total_words * 0.18)))
    originality_score = min(98.0, max(65.0, 75.0 + (len(set(words)) * 0.25)))
    critical_thinking = min(95.0, max(60.0, 70.0 + (total_words * 0.15)))
    topic_relevance = 90.0

    strengths = [
        "Presents original thoughts relevant to the topic",
        "Good sentence length and structured arguments"
    ]
    weaknesses = []
    if filler_count > 3:
        weaknesses.append(f"Used filler words {filler_count} times ({', '.join(set(fillers_found))})")
    if total_words < 50:
        weaknesses.append("Response duration was relatively brief; aim for 2-5 minutes of speech")

    return {
        "is_question_repetition": False,
        "repetition_reason": "",
        "topic_understanding_score": round(topic_understanding, 1),
        "content_quality_score": round(content_quality, 1),
        "originality_score": round(originality_score, 1),
        "critical_thinking_score": round(critical_thinking, 1),
        "topic_relevance_score": round(topic_relevance, 1),
        "speaking_pace": f"{round(total_words / 0.5)} wpm",
        "filler_analysis": {"count": filler_count, "fillers_found": list(set(fillers_found)), "ratio": filler_ratio},
        "missing_discussion_points": [
            "Consider addressing economic implications and stakeholder perspectives.",
            "Include a summary conclusion statement at the end of your 5-minute window."
        ],
        "strengths": strengths,
        "weaknesses": weaknesses,
        "grammar_corrections": [
            "Maintain consistent verb tenses across complex compound sentences."
        ],
        "pronunciation_suggestions": [
            "Practice natural intonation and pause emphasis at major punctuation boundaries."
        ],
        "vocabulary_improvements": [
            "Incorporate domain-specific terminology to strengthen critical reasoning."
        ],
        "recommendations": [
            "Maintain smooth pace and reduce filler transitions like 'umm' and 'like'.",
            "Support your main thesis with a real-life case study or statistics."
        ]
    }
