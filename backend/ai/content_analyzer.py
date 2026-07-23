import re
from typing import Any

def calculate_copy_ratio(text: str, other_texts: list[str]) -> float:
    if not other_texts:
        return 0.0
    words = re.findall(r'\b\w+\b', text.lower())
    if len(words) < 5:
        return 0.0
    
    # Extract 4-word shingles to detect exact phrase copying
    shingles = []
    for i in range(len(words) - 3):
        shingles.append(" ".join(words[i:i+4]))
        
    if not shingles:
        return 0.0
        
    matched = 0
    for sh in shingles:
        for ot in other_texts:
            if sh in ot.lower():
                matched += 1
                break
                
    return matched / len(shingles)

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
            "speaking_pace": "0 wpm",
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
    
    # 1. Filler analysis
    fillers = ["uh", "umm", "um", "like", "actually", "basically", "you know", "hmm", "er"]
    fillers_found = [w for w in words if w in fillers]
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

    # 3. Sentence duplication
    sentences = [s.strip() for s in re.split(r'[.!?]', text) if len(s.strip()) > 3]
    if len(sentences) >= 2:
        unique_sentences = set(sentences)
        if len(unique_sentences) / len(sentences) < 0.5:
            is_question_repetition = True
            repetition_reason = "Repeated identical sentences multiple times without adding new thoughts."

    # 4. Extremely low unique vocabulary ratio
    if total_words > 15 and (unique_words / total_words) < 0.35:
        is_question_repetition = True
        repetition_reason = "Extremely repetitive vocabulary without meaningful discussion content."

    if is_question_repetition:
        return {
            "is_question_repetition": True,
            "repetition_reason": repetition_reason,
            "topic_understanding_score": 15.0,
            "content_quality_score": 10.0,
            "originality_score": 10.0,
            "critical_thinking_score": 10.0,
            "topic_relevance_score": 15.0,
            "speaking_pace": f"{total_words} words total",
            "filler_analysis": {"count": filler_count, "fillers_found": list(set(fillers_found)), "ratio": filler_ratio},
            "missing_discussion_points": [
                "Provide original personal perspectives and real-world examples.",
                "Structure your response: Intro → Core Arguments → Counterpoints → Conclusion.",
                "Avoid reading or repeating the question prompt."
            ],
            "strengths": [],
            "weaknesses": ["Question Repetition / No Meaningful Content detected.", repetition_reason],
            "grammar_corrections": ["Try expanding simple declarative sentences into multi-clause analytical points."],
            "pronunciation_suggestions": ["Ensure distinct articulation when stating key technical terms."],
            "vocabulary_improvements": ["Use analytical verbs such as 'demonstrates', 'substantiates', 'implies', 'accelerates'."],
            "recommendations": [
                "Express original thoughts instead of repeating the topic title.",
                "Elaborate on why you agree or disagree using concrete evidence."
            ]
        }

    # Fetch other speaker transcripts from MySQL to calculate dynamic originality score
    other_transcripts = []
    try:
        from backend.database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT transcript FROM gd_live_evaluations WHERE evaluated_at >= NOW() - INTERVAL 4 HOUR")
        for row in cursor.fetchall():
            t = row.get("transcript", "").strip()
            if t and t.lower() != text.lower():
                other_transcripts.append(t)
        cursor.close()
        conn.close()
    except Exception:
        pass

    copy_ratio = calculate_copy_ratio(text, other_transcripts)
    originality_score = 96.0 - (copy_ratio * 100.0)
    
    # Generic definition boilerplate check
    boilerplate_patterns = [
        r"good morning everyone", r"today i am going to speak about", 
        r"artificial intelligence is ai", r"topic of this discussion is"
    ]
    boilerplate_count = sum(1 for pat in boilerplate_patterns if re.search(pat, text.lower()))
    originality_score = max(15.0, originality_score - boilerplate_count * 8.0)

    # 5. Content Quality with transition words checks
    has_intro = any(t in text.lower() for t in ["firstly", "to begin", "in my opinion", "i believe", "from my perspective", "today's topic", "my stance"])
    has_example = any(t in text.lower() for t in ["for example", "for instance", "such as", "to illustrate", "specifically", "case study"])
    has_reason = any(t in text.lower() for t in ["because", "since", "therefore", "consequently", "as a result", "leads to", "due to", "enables"])
    has_counter = any(t in text.lower() for t in ["however", "although", "on the other hand", "whereas", "in contrast", "conversely"])
    has_concl = any(t in text.lower() for t in ["in conclusion", "to sum up", "finally", "ultimately", "in summary"])

    content_score = 25.0
    if has_intro: content_score += 15.0
    if has_example: content_score += 15.0
    if has_reason: content_score += 20.0
    if has_counter: content_score += 15.0
    if has_concl: content_score += 10.0
    
    # Length scaling
    length_bonus = min(10.0, (total_words / 15.0))
    content_quality_score = max(20.0, min(98.0, content_score + length_bonus))

    # 6. Topic Understanding Check (domain terms lookup)
    domain_terms_matched = 0
    domain_dictionary = {
        "education": ["student", "learning", "classroom", "pedagogy", "school", "university", "academic", "knowledge", "study", "curriculum", "skills", "tutoring", "assessment"],
        "intelligence": ["algorithm", "machine", "automation", "digital", "data", "computation", "software", "neural", "computing", "model", "processor", "ai", "deep learning"],
        "health": ["doctor", "healthcare", "disease", "imaging", "treatment", "diagnosis", "medicine", "patient", "clinical", "hospitals", "medical"],
        "economy": ["finance", "industry", "workers", "jobs", "employment", "growth", "regulatory", "business", "market", "displacement", "income"]
    }
    
    # Core topic title word overlap ratio
    topic_overlap = 0.0
    if topic_text:
        topic_words = set(re.findall(r'\b\w+\b', topic_text.lower()))
        stop_words = {"the", "is", "at", "which", "on", "a", "an", "and", "or", "in", "of", "to", "for", "with", "vs", "are", "be"}
        core_topic = topic_words - stop_words
        if core_topic:
            overlap_words = core_topic.intersection(set(words))
            topic_overlap = len(overlap_words) / len(core_topic)
            
        # Match topic domain concepts
        for domain, terms in domain_dictionary.items():
            if domain in topic_text.lower():
                domain_terms_matched += sum(1 for w in words if w in terms)

    topic_understanding_score = 30.0 + (topic_overlap * 40.0) + (min(6, domain_terms_matched) * 5.0)
    topic_understanding_score = max(20.0, min(98.0, topic_understanding_score))

    # 7. Critical Thinking Check (Why, How, Evidence, Solutions)
    why_count = len(re.findall(r'\b(because|since|reason|why|explain)\b', text.lower()))
    how_count = len(re.findall(r'\b(how|by|through|mechanism|process)\b', text.lower()))
    evidence_count = len(re.findall(r'\b(statistics|percent|%|data|evidence|research|study|statistics)\b', text.lower()))
    solution_count = len(re.findall(r'\b(solve|solution|mitigate|address|resolution|improve|strategy)\b', text.lower()))

    critical_thinking_score = 30.0 + (why_count * 8.0) + (how_count * 8.0) + (evidence_count * 12.0) + (solution_count * 10.0)
    critical_thinking_score = max(20.0, min(97.0, critical_thinking_score))

    # 8. Topic Relevance Check (percentage of sentences related to topic)
    relevant_sentences = 0
    if sentences:
        topic_terms = set(re.findall(r'\b\w+\b', topic_text.lower())) - {"the", "is", "at", "which", "on", "a", "an", "and", "or"}
        for s in sentences:
            s_words = set(re.findall(r'\b\w+\b', s.lower()))
            if s_words.intersection(topic_terms) or any(t in s_words for domain, terms in domain_dictionary.items() for t in terms if domain in topic_text.lower()):
                relevant_sentences += 1
        topic_relevance_score = (relevant_sentences / len(sentences)) * 100.0
    else:
        topic_relevance_score = 20.0
    topic_relevance_score = max(15.0, min(100.0, topic_relevance_score))

    # Generate Strengths, Weaknesses, Recommendations based on concrete logic
    strengths = []
    weaknesses = []
    recommendations = []

    if copy_ratio < 0.15:
        strengths.append("Presents highly original ideas free from repetitive patterns.")
    else:
        weaknesses.append(f"Contains {round(copy_ratio * 100)}% structural copying/repetition of other speaker transcripts.")
        recommendations.append("Express original thoughts instead of repeating statements made by previous speakers.")

    if has_example:
        strengths.append("Supported main thesis with concrete real-life examples.")
    else:
        weaknesses.append("Lacks specific real-world examples or scenarios to reinforce claims.")
        recommendations.append("Elaborate on your claims by citing real-world examples (e.g. diagnostic imaging in healthcare).")

    if evidence_count > 0:
        strengths.append("Demonstrated logical reasoning supported by data/evidence indicators.")
    else:
        recommendations.append("Incorporate statistics, research references, or concrete data points to substantiate arguments.")

    if filler_count > 3:
        weaknesses.append(f"You used the filler word '{fillers_found[0]}' {filler_count} times.")
        recommendations.append(f"Minimize vocal hesitations and filler transitions (filler count: {filler_count}).")

    if not strengths:
        strengths.append("Clear audio connection and articulation.")

    return {
        "is_question_repetition": False,
        "repetition_reason": "",
        "topic_understanding_score": round(topic_understanding_score, 1),
        "content_quality_score": round(content_quality_score, 1),
        "originality_score": round(originality_score, 1),
        "critical_thinking_score": round(critical_thinking_score, 1),
        "topic_relevance_score": round(topic_relevance_score, 1),
        "speaking_pace": f"{round(total_words / 0.5)} wpm",
        "filler_analysis": {"count": filler_count, "fillers_found": list(set(fillers_found)), "ratio": filler_ratio},
        "missing_discussion_points": [
            "Consider addressing economic implications and stakeholder perspectives.",
            "Include a summary conclusion statement at the end of your speaking turn."
        ] if not has_concl else ["Incorporate comparative solutions of multiple stakeholders."],
        "strengths": strengths,
        "weaknesses": weaknesses,
        "grammar_corrections": ["Try expanding simple declarative sentences into multi-clause analytical points."],
        "pronunciation_suggestions": ["Practice natural intonation and pause emphasis at major punctuation boundaries."],
        "vocabulary_improvements": ["Incorporate domain-specific terminology to strengthen critical reasoning."],
        "recommendations": recommendations if recommendations else ["Maintain clean speech pauses and expand on arguments."]
    }
