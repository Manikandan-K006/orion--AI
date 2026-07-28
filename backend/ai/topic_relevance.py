"""Topic relevance and content quality analysis.

Evaluates whether a student's transcript semantically addresses the assigned
GD topic and provides meaningful arguments, reasoning, examples, or conclusions.

Uses TF-IDF cosine similarity combined with sentence-level alignment,
domain concept mapping, and argument structure analysis.
"""

import re
import math
from typing import Any

STOP_WORDS = frozenset({
    "the", "is", "at", "which", "on", "a", "an", "and", "or", "in", "of", "to",
    "for", "with", "vs", "are", "be", "what", "how", "why", "do", "does", "did",
    "have", "has", "had", "will", "would", "could", "should", "may", "might",
    "shall", "can", "need", "dare", "ought", "used", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
    "us", "them", "my", "your", "his", "its", "our", "their", "mine", "yours",
    "hers", "ours", "theirs", "am", "was", "were", "been", "being", "from",
    "by", "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then", "once",
    "here", "there", "when", "where", "also", "even", "well", "back",
    "much", "many", "get", "got", "go", "going", "went", "come", "came",
    "know", "knew", "think", "thought", "see", "saw", "make", "made",
    "take", "took", "give", "gave", "say", "said", "tell", "told",
    "use", "used", "find", "found", "want", "wanted", "let", "keep",
    "try", "tried", "put", "set", "run", "move", "like",
    "look", "turn", "start", "show", "just", "still", "only",
    "don", "now", "about", "up", "but", "if", "because", "until",
    "while", "although", "though", "since", "unless", "except",
    "whether", "so", "too", "very", "own", "same", "than",
    "some", "such", "no", "nor", "not", "more", "most", "other",
    "few", "each", "both", "all", "any", "every",
})

DOMAIN_CONCEPTS: dict[str, set[str]] = {
    "education": {"student", "learning", "classroom", "pedagogy", "school", "university", "academic", "knowledge", "study", "curriculum", "skills", "tutoring", "assessment", "teaching", "teacher", "educator", "exam", "grade"},
    "technology": {"algorithm", "machine", "automation", "digital", "data", "computation", "software", "neural", "computing", "model", "processor", "ai", "deep learning", "artificial intelligence", "robot", "computer", "code", "programming", "innovation"},
    "health": {"doctor", "healthcare", "disease", "imaging", "treatment", "diagnosis", "medicine", "patient", "clinical", "hospitals", "medical", "therapy", "surgery", "symptom", "cure", "wellness"},
    "economy": {"finance", "industry", "workers", "jobs", "employment", "growth", "regulatory", "business", "market", "displacement", "income", "investment", "gdp", "inflation", "trade", "policy"},
    "environment": {"climate", "pollution", "sustainability", "renewable", "carbon", "emission", "ecosystem", "biodiversity", "conservation", "recycle", "energy", "green"},
    "society": {"culture", "community", "social", "equality", "diversity", "inclusion", "rights", "justice", "democracy", "governance", "policy", "welfare"},
}

_REASONING_PATTERNS = [
    (r'\b(because|since|therefore|consequently|thus|hence|as a result|reason is)\b', "reasoning"),
    (r'\b(for example|for instance|such as|specifically|to illustrate|e\.g\.|consider)\b', "examples"),
    (r'\b(however|although|on the other hand|nevertheless|despite|conversely|whereas|in contrast)\b', "counterpoint"),
    (r'\b(in conclusion|to summarize|overall|in summary|to sum up|ultimately|concluding)\b', "conclusion"),
    (r'\b(i believe|i think|in my opinion|from my perspective|i argue|i contend|in my view)\b', "opinion"),
    (r'\b(data|research|evidence|statistics|studies|reports|findings|according to)\b', "evidence"),
    (r'\b(first|second|third|firstly|secondly|thirdly|additionally|furthermore|moreover)\b', "structure"),
    (r'\b(should|must|need to|have to|ought to|important|essential|crucial|vital)\b', "recommendation"),
]

RELEVANCE_THRESHOLDS = {
    "highly_relevant": 70,
    "relevant": 50,
    "partially_relevant": 30,
    "mostly_off_topic": 10,
}


def _tokenize(text: str) -> list[str]:
    return [w for w in re.findall(r'\b[a-z]{3,}\b', text.lower()) if w not in STOP_WORDS]


def _tfidf_cosine(text_a: str, text_b: str) -> float:
    words_a = _tokenize(text_a)
    words_b = _tokenize(text_b)
    if not words_a or not words_b:
        return 0.0

    vocab = list(set(words_a + words_b))
    idx = {w: i for i, w in enumerate(vocab)}
    n = len(vocab)

    def _tf(words: list[str]) -> list[float]:
        vec = [0.0] * n
        for w in words:
            vec[idx[w]] += 1
        length = len(words)
        return [v / length for v in vec]

    def _idf(word: str) -> float:
        doc_count = (1 if word in words_a else 0) + (1 if word in words_b else 0)
        return math.log(2.0 / max(1, doc_count)) + 1.0

    tf_a = _tf(words_a)
    tf_b = _tf(words_b)
    idf_vec = [_idf(w) for w in vocab]

    vec_a = [t * i for t, i in zip(tf_a, idf_vec)]
    vec_b = [t * i for t, i in zip(tf_b, idf_vec)]

    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _domain_concept_score(text_words: list[str], topic_text: str) -> float:
    matched = 0
    total = 0
    for domain, concepts in DOMAIN_CONCEPTS.items():
        if any(kw in topic_text.lower() for kw in [domain] + list(concepts)[:3]):
            domain_matches = sum(1 for w in text_words if w in concepts)
            matched += domain_matches
            total += max(1, len(concepts) // 2)
    if total == 0:
        return 0.0
    return min(100.0, (matched / max(1, total)) * 100.0)


def analyze_topic_relevance(transcript: str, topic: str) -> dict[str, Any]:
    text = transcript.strip()
    topic_text = topic.strip()

    if not text or len(text.split()) < 3:
        return {
            "relevance_score": 0.0,
            "content_quality_score": 0.0,
            "off_topic_percentage": 100.0,
            "relevant_points": [],
            "irrelevant_points": [],
            "reasoning_quality": 0.0,
            "feedback": "No usable speech content detected.",
            "classification": "off_topic",
        }

    if not topic_text:
        return {
            "relevance_score": 30.0,
            "content_quality_score": 30.0,
            "off_topic_percentage": 70.0,
            "relevant_points": [],
            "irrelevant_points": [],
            "reasoning_quality": 30.0,
            "feedback": "No topic provided for relevance analysis.",
            "classification": "partially_relevant",
        }

    semantic_sim = _tfidf_cosine(text, topic_text)

    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if len(s.strip()) > 5]
    topic_words = _tokenize(topic_text)

    relevant_sentences: list[str] = []
    irrelevant_sentences: list[str] = []

    for s in sentences:
        s_words = set(_tokenize(s))
        topic_overlap = len(s_words.intersection(set(topic_words)))
        if topic_overlap >= 2:
            relevant_sentences.append(s)
        else:
            irrelevant_sentences.append(s)

    sentence_relevance = (len(relevant_sentences) / max(1, len(sentences))) * 100.0

    reasoning_hits: dict[str, int] = {}
    for pattern, category in _REASONING_PATTERNS:
        count = len(re.findall(pattern, text.lower()))
        if count > 0:
            reasoning_hits[category] = count

    reasoning_categories_hit = len(reasoning_hits)
    reasoning_total = sum(reasoning_hits.values())
    reasoning_quality = min(100.0, (reasoning_categories_hit / 4.0) * 60 + min(40, reasoning_total * 5))

    all_words = _tokenize(text)
    unique_ratio = len(set(all_words)) / max(1, len(all_words))
    vocab_diversity_score = min(100.0, unique_ratio * 130)

    domain_score = _domain_concept_score(all_words, topic_text)

    relevance_score = (
        semantic_sim * 30
        + sentence_relevance * 0.30 * 100 / 100
        + reasoning_quality * 0.20
        + vocab_diversity_score * 0.10
        + domain_score * 0.10
    )
    relevance_score = max(0.0, min(100.0, relevance_score))

    content_quality_score = (
        sentence_relevance * 0.30
        + reasoning_quality * 0.35
        + vocab_diversity_score * 0.15
        + domain_score * 0.20
    )
    content_quality_score = max(0.0, min(100.0, content_quality_score))

    off_topic_percentage = max(0.0, min(100.0, 100.0 - sentence_relevance))

    if relevance_score >= RELEVANCE_THRESHOLDS["highly_relevant"]:
        classification = "highly_relevant"
    elif relevance_score >= RELEVANCE_THRESHOLDS["relevant"]:
        classification = "relevant"
    elif relevance_score >= RELEVANCE_THRESHOLDS["partially_relevant"]:
        classification = "partially_relevant"
    elif relevance_score >= RELEVANCE_THRESHOLDS["mostly_off_topic"]:
        classification = "mostly_off_topic"
    else:
        classification = "off_topic"

    parts: list[str] = []
    if classification == "highly_relevant":
        parts.append("Strong topic alignment with well-structured arguments.")
    elif classification == "relevant":
        parts.append("Good topic relevance with supporting arguments.")
    elif classification == "partially_relevant":
        parts.append("Some relevance to the topic but could be more focused.")
    elif classification == "mostly_off_topic":
        parts.append("Content drifts significantly from the assigned topic.")
    else:
        parts.append("Content is largely unrelated to the assigned topic.")

    if reasoning_categories_hit < 3:
        missing = [cat for cat in ["reasoning", "examples", "counterpoint", "conclusion"] if cat not in reasoning_hits]
        if missing:
            parts.append(f"Strengthen with: {', '.join(missing)}.")

    return {
        "relevance_score": round(relevance_score, 1),
        "content_quality_score": round(content_quality_score, 1),
        "off_topic_percentage": round(off_topic_percentage, 1),
        "relevant_points": relevant_sentences[:5],
        "irrelevant_points": irrelevant_sentences[:5],
        "reasoning_quality": round(reasoning_quality, 1),
        "feedback": " ".join(parts),
        "classification": classification,
    }
