        vocab_val = float(db_eval["content_quality"] if db_eval else mem_eval.get("vocabulary_score", 75.0))
        
        # Extended metrics
        originality_val = float(db_eval.get("originality_score") if db_eval and db_eval.get("originality_score") else mem_eval.get("originality_score", 82.0))
        critical_thinking_val = float(db_eval.get("critical_thinking_score") if db_eval and db_eval.get("critical_thinking_score") else mem_eval.get("critical_thinking_score", 84.0))
        topic_understanding_val = float(db_eval.get("topic_understanding_score") if db_eval and db_eval.get("topic_understanding_score") else mem_eval.get("topic_understanding_score", 85.0))
        
        # Simulated/Computed:
        communication_val = round((fluency_val + pronunciation_val + grammar_val) / 3, 1)
        listening_val = max(55.0, min(95.0, 92 - ts.interruption_counts.get(uid, 0) * 8))
        teamwork_val = max(50.0, min(96.0, 75 + len(ts.agree_disagree_votes.get(uid, {}).get("agree", set())) * 5))
        leadership_val = max(50.0, min(96.0, 70 + (10 if uid == ts.consensus_claimed_by else 0) + (ts.relevant_points_count.get(uid, 0) * 3)))
        confidence_val = float(db_eval.get("confidence_score") if db_eval and db_eval.get("confidence_score") else mem_eval.get("confidence_score", 80.0))
        creativity_val = round((originality_val + critical_thinking_val) / 2, 1)

        results.append({
            "user_id": uid,
            "name": member.get("name"),
            "label": member.get("label") or member.get("anonymous_label"),
            "overall_score": overall_val,
            "grammar": grammar_val,
            "vocabulary": vocab_val,
            "pronunciation": pronunciation_val,
            "relevance": relevance_val,
            "communication": communication_val,
            "listening": listening_val,
            "teamwork": teamwork_val,
            "leadership": leadership_val,
            "confidence": confidence_val,
            "critical_thinking": critical_thinking_val,
            "creativity": creativity_val,
            "topic_understanding": topic_understanding_val,
            "speaking_time": f"{int(ts.speaking_durations.get(uid, 0.0))}s",
            "interruption_count": ts.interruption_counts.get(uid, 0),
            "relevant_points": ts.relevant_points_count.get(uid, 0),
            "off_topic_count": ts.off_topic_count.get(uid, 0)
        })

    # Sort results to assign ranks
    results.sort(key=lambda r: r["overall_score"], reverse=True)
    for idx, r in enumerate(results, 1):
        r["rank"] = idx

    # Award designations:
    awards = {}
    if results:
        # Best Speaker: Highest Communication
        best_speaker = max(results, key=lambda r: r["communication"])
        awards["Best Speaker"] = best_speaker["user_id"]
        
        # Best Listener: Highest Listening
        best_listener = max(results, key=lambda r: r["listening"])
        awards["Best Listener"] = best_listener["user_id"]
        
        # Best Leader: Highest Leadership
        best_leader = max(results, key=lambda r: r["leadership"])
        awards["Best Leader"] = best_leader["user_id"]
        
        # Most Innovative Thinker: Highest Creativity
        most_innovative = max(results, key=lambda r: r["creativity"])
        awards["Most Innovative Thinker"] = most_innovative["user_id"]
        
        # Most Supportive Member: Highest Teamwork
        most_supportive = max(results, key=lambda r: r["teamwork"])
        awards["Most Supportive Member"] = most_supportive["user_id"]
        
    ts.awards = awards

    # Broadcast results to team and admin
    await manager.broadcast_to_team(session_code, team_number, "SESSION_RESULTS", {
        "session_code": session_code,
        "team_number": team_number,
        "results": results,
        "key_points": key_points,
        "awards": {name: ts.members[uid]["name"] for name, uid in awards.items()},
        "winner": results[0] if results else None
    })
    await manager.broadcast_to_admin(session_code, "SESSION_RESULTS", {
        "session_code": session_code,
        "team_number": team_number,
        "results": results,
        "key_points": key_points,
        "awards": {name: ts.members[uid]["name"] for name, uid in awards.items()},
        "winner": results[0] if results else None
    })


async def silence_detector_task(session_code: str):
    logger.info("Silence detector started for session %s", session_code)
    try:
        while True:
            await asyncio.sleep(1.0)
            state = manager.get_state(session_code)
            if not state or state.ended or state.paused:
                continue
            for tn, ts in state.team_states.items():
                if ts.round == 2 and ts.timer_running:
                    import time
                    now = time.time()
                    if ts.last_activity_time > 0 and (now - ts.last_activity_time) > 5.0:
                        ts.last_activity_time = now # reset
                        eligible_members = [
                            uid for uid in ts.members.keys() 
                            if uid not in ts.finished_user_ids
                        ]
                        if not eligible_members:
                            continue
                        target_uid = random.choice(eligible_members)
                        target_name = ts.members[target_uid].get("name", "Student")
                        
                        prompts = [
                            f"Would anyone like to add another point? {target_name}, what is your opinion?",
                            f"We have a slight pause here. {target_name}, can you share your thoughts on the points raised so far?",
                            f"Let's keep the momentum going. {target_name}, how would you approach this topic?",
                            f"I'd love to hear another perspective. {target_name}, what is your take on this?"
                        ]
                        prompt_text = random.choice(prompts)
                        
                        await manager.broadcast_to_team(session_code, tn, "CHAT_MESSAGE", {
                            "user_id": 0,
                            "name": "AI Moderator",
                            "label": "🤖 Moderator",
                            "text": prompt_text
                        })
                        await manager.broadcast_to_team(session_code, tn, "AI_MODERATOR_PROMPT", {
                            "text": prompt_text,
                            "target_user_id": target_uid
                        })
    except asyncio.CancelledError:
        logger.info("Silence detector cancelled for session %s", session_code)
    except Exception as exc:
        logger.error("Silence detector error: %s", exc)



def check_ai_moderator_rules(user_id: int, name: str, text: str, topic: str) -> dict | None:
    words = re.findall(r'\b\w+\b', text.lower())
    if not words or len(words) < 3:
        return None

    topic_words = set(re.findall(r'\b\w+\b', topic.lower()))
    stop_words = {"should", "be", "in", "the", "a", "an", "is", "are", "and", "or", "of", "to", "for", "with", "on", "at", "by", "from", "my", "your", "what", "how", "why", "can", "do", "does"}
    meaningful_topic_words = topic_words - stop_words
    
    # 1. Question Repetition Detection
    topic_cleaned = re.sub(r'[^\w\s]', '', topic.lower()).strip()
    text_cleaned = re.sub(r'[^\w\s]', '', text.lower()).strip()
    
    matched_topic_words = [w for w in words if w in meaningful_topic_words]
    unique_new_words = set(words) - stop_words - meaningful_topic_words

    # Flag if user repeats main topic keywords without adding original thoughts
    if len(meaningful_topic_words) >= 2 and len(matched_topic_words) >= max(2, int(len(meaningful_topic_words) * 0.5)) and len(unique_new_words) < 4:
        return {
            "user_id": user_id,
            "type": "repetition",
            "message": f"🤖 AI Moderator: {name}, please do not repeat the discussion question. Provide your own original points and arguments!"
        }

    if len(topic_cleaned) > 8 and topic_cleaned in text_cleaned and len(words) < len(re.findall(r'\b\w+\b', topic)) + 6:
        return {
            "user_id": user_id,
            "type": "repetition",
            "message": f"🤖 AI Moderator: {name}, please do not repeat the question! Explain your stance with your own supporting points."
        }

    # 2. Filler words detection
    filler_words = ["uh", "umm", "um", "like", "actually", "basically"]
    fillers = [w for w in words if w in filler_words]
    if len(fillers) >= 3:
        return {
            "user_id": user_id,
            "type": "filler",
            "message": f"🤖 AI Moderator: {name}, try to reduce filler words like '{fillers[-1]}' to improve your fluency."
        }

    # 3. Repeated words / grammar check
    double_words = re.search(r'\b(\w+)\s+\1\b', text.lower())
    if double_words:
        return {
            "user_id": user_id,
            "type": "grammar",
            "message": f"🤖 AI Moderator: {name}, pay attention to sentence structure and avoid repeating words like '{double_words.group(1)}'."
        }

    return None


def calculate_live_metrics(text: str) -> dict:
    words = re.findall(r'\b\w+\b', text.lower())
    total_words = len(words)
    unique_words = len(set(words))
    
    # Grammar & Double words check
    double_words = re.findall(r'\b(\w+)\s+\1\b', text.lower())
    grammar = max(55, min(96, 92 - len(double_words) * 6 - (total_words // 25) * 2))
    
    # Fluency & Filler words
    filler_words = ["uh", "umm", "um", "like", "actually", "basically", "you know"]
    fillers = [w for w in words if w in filler_words]
    fluency = max(50, min(98, 94 - len(fillers) * 5))
    
    # Confidence & Vocabulary
    confidence = max(55, min(95, 72 + (total_words // 8) * 3))
    vocab = max(50, min(96, 62 + (unique_words * 2.2)))
    quality = max(55, min(96, 68 + (total_words // 12) * 3.5))
    
    overall = round((grammar + fluency + confidence + vocab + quality) / 5, 1)
    
    # Emotion detection
    if any(w in text.lower() for w in ["strongly", "definitely", "certainly", "clearly", "proven"]):
        emotion = "Confident"
    elif any(w in text.lower() for w in ["however", "whereas", "statistics", "data", "reason", "impact"]):
        emotion = "Analytical"
    elif any(w in text.lower() for w in ["great", "excited", "important", "vital", "transform"]):
        emotion = "Enthusiastic"
    else:
        emotion = "Thoughtful"

    # Interaction & Speech Markers
    text_lower = text.lower()
    agreements = len(re.findall(r'\b(agree|support|second|building on|aligned)\b', text_lower))
    disagreements = len(re.findall(r'\b(disagree|however|oppose|counter|alternative|different view)\b', text_lower))
    questions_asked = text.count("?") + len(re.findall(r'\b(what do you think|how can we|why should|do you agree)\b', text_lower))
    wpm = min(180, max(90, total_words * 4))

    # Pronunciation proxy: clear delivery is penalized by double words & fillers
    pronunciation = max(55, min(96, 90 - len(double_words) * 4 - len(fillers) * 3))

    # Relevance: reward reasoning & topic-marker words that stay on-topic
    reasoning_words = ["because", "therefore", "however", "example", "for instance", "data", "statistics", "impact", "reason", "result", "benefit", "solution", "conclusion"]
    reasoning_hits = sum(1 for w in reasoning_words if w in text_lower)
    relevance = max(55, min(96, 66 + reasoning_hits * 6))

    return {
        "grammar": round(grammar, 1),
        "fluency": round(fluency, 1),
        "confidence": round(confidence, 1),
        "vocabulary": round(vocab, 1),
        "quality": round(quality, 1),
        "pronunciation": round(pronunciation, 1),
        "relevance": round(relevance, 1),
        "overall": round(overall, 1),
        "emotion": emotion,
        "wpm": wpm,
        "filler_count": len(fillers),
        "agreements": agreements,
        "disagreements": disagreements,
        "questions_asked": questions_asked,
    }


def _save_evaluation_db_detailed(session_code: str, user_id: int, team_number: int, transcript: str, topic: str, ts: TeamState) -> None:
    connection = get_connection()
    try:
        from backend.ai.evaluation import evaluate_transcript
        result = evaluate_transcript(transcript, topic=topic)
        scores = _compute_scores_sync(result)
        
        # Populate in-memory evaluations dict immediately to prevent race conditions
        ts.evaluations[user_id] = {
            "overall_score": float(scores["overall"]),
            "grammar_score": float(result.grammar_score),
            "confidence_score": float(result.confidence_score),
            "fluency_score": float(result.fluency_score),
            "vocabulary_score": float(result.vocabulary_score),
            "pronunciation_score": float(result.pronunciation_score),
            "originality_score": float(result.originality_score),
            "critical_thinking_score": float(result.critical_thinking_score),
            "topic_understanding_score": float(result.topic_understanding_score),
            "voice_clarity_score": float(result.pronunciation_score),
            "body_language_score": 85.0,
            "eye_contact_score": 85.0,
            "filler_words_count": result.filler_count,
            "speech_speed_wpm": int(result.wpm),
            "pauses_count": result.long_pause_count,
            "weaknesses": scores["weaknesses"],
            "tips": scores["tips"],
            "strengths": "; ".join(result.strengths),
            "recommendations": "; ".join(result.recommendations),
            "missing_discussion_points": "; ".join(result.missing_discussion_points)
        }
        
        queries.save_live_evaluation(
            connection, session_code, user_id, team_number, transcript,
            scores["overall"], result.fluency_score, result.grammar_score,
            result.pronunciation_score, result.topic_relevance_score, result.content_quality_score,
            scores["points"], scores["weaknesses"], scores["tips"],
            originality_score=result.originality_score,
            critical_thinking_score=result.critical_thinking_score,
            topic_understanding_score=result.topic_understanding_score,
            voice_clarity_score=result.pronunciation_score,
            body_language_score=85.0,
            eye_contact_score=85.0,
            confidence_score=result.confidence_score,
            filler_words_count=ts.evaluations[user_id]["filler_words_count"],
            speech_speed_wpm=ts.evaluations[user_id]["speech_speed_wpm"],
            pauses_count=ts.evaluations[user_id]["pauses_count"],
            missing_discussion_points=ts.evaluations[user_id]["missing_discussion_points"],
            strengths=ts.evaluations[user_id]["strengths"],
            recommendations=ts.evaluations[user_id]["recommendations"]
        )
        logger.info("Detailed evaluation saved uid=%s code=%s team=%s score=%s", user_id, session_code, team_number, scores["overall"])
    except Exception as exc:
        logger.warning("_save_evaluation_db_detailed failed: %s", exc)
    finally:
        _return(connection)


async def wait_and_broadcast_results(session_code: str, team_number: int, ts: TeamState) -> None:
    await asyncio.sleep(4)
    connection = get_connection()
    team_evals = {}
    try:
        evals = queries.get_live_leaderboard(connection, session_code)
        team_evals = {e["user_id"]: e for e in evals if e["team_number"] == team_number}
    except Exception as exc:
        logger.warning("wait_and_broadcast_results DB query failed: %s", exc)
    finally:
        _return(connection)

    results = []
    for uid, member in ts.members.items():
        db_eval = team_evals.get(uid)
        mem_eval = ts.evaluations.get(uid, {})
        
        results.append({
            "user_id": uid,
            "name": member.get("name"),
            "label": member.get("label"),
            "overall_score": float(db_eval["overall_score"] if db_eval else mem_eval.get("overall_score", 70.0)),
            "grammar_score": float(db_eval["grammar_score"] if db_eval else mem_eval.get("grammar_score", 70.0)),
            "confidence_score": float(db_eval["confidence_score"] if db_eval else mem_eval.get("confidence_score", 70.0)),
            "fluency_score": float(db_eval["fluency_score"] if db_eval else mem_eval.get("fluency_score", 70.0)),
            "vocabulary_score": float(db_eval["content_quality"] if db_eval else mem_eval.get("vocabulary_score", 70.0)),
            "pronunciation_score": float(db_eval["accent_score"] if db_eval else mem_eval.get("pronunciation_score", 70.0)),
            "originality_score": float(db_eval.get("originality_score") if db_eval else mem_eval.get("originality_score", 75.0)),
            "critical_thinking_score": float(db_eval.get("critical_thinking_score") if db_eval else mem_eval.get("critical_thinking_score", 75.0)),
            "topic_understanding_score": float(db_eval.get("topic_understanding_score") if db_eval else mem_eval.get("topic_understanding_score", 75.0)),
            "voice_clarity_score": float(db_eval.get("voice_clarity_score") if db_eval else mem_eval.get("voice_clarity_score", 75.0)),
            "body_language_score": float(db_eval.get("body_language_score") if db_eval else mem_eval.get("body_language_score", 85.0)),
            "eye_contact_score": float(db_eval.get("eye_contact_score") if db_eval else mem_eval.get("eye_contact_score", 85.0)),
            "filler_words_count": int(db_eval.get("filler_words_count") if db_eval else mem_eval.get("filler_words_count", 0)),
            "speech_speed_wpm": int(db_eval.get("speech_speed_wpm") if db_eval else mem_eval.get("speech_speed_wpm", 0)),
            "pauses_count": int(db_eval.get("pauses_count") if db_eval else mem_eval.get("pauses_count", 0)),
            "weaknesses": db_eval.get("weaknesses") if db_eval else mem_eval.get("weaknesses", ""),
            "tips": db_eval.get("improvement_tips") if db_eval else mem_eval.get("tips", ""),
            "strengths": db_eval.get("strengths") if db_eval else mem_eval.get("strengths", ""),
            "recommendations": db_eval.get("recommendations") if db_eval else mem_eval.get("recommendations", ""),
            "missing_discussion_points": db_eval.get("missing_discussion_points") if db_eval else mem_eval.get("missing_discussion_points", "")
        })

    try:
        await manager.broadcast_to_team(session_code, team_number, "SESSION_RESULTS", {
            "session_code": session_code,
            "team_number": team_number,
            "results": results
        })
        await manager.broadcast_to_admin(session_code, "SESSION_RESULTS", {
            "session_code": session_code,
            "team_number": team_number,
            "results": results
        })
    except Exception as exc:
        logger.warning("broadcast SESSION_RESULTS failed: %s", exc)


class TeamState:
    """Per-team state for 1-minute turn-based video GD."""

    def __init__(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 60) -> None:
        self.team_number = team_number
        self.topic = topic
        self.members: dict[int, dict] = {m["user_id"]: m for m in members}
        self.finished_user_ids: set[int] = set()
        self.all_finished = False
        self.timer_seconds = 60  # Always 60 seconds per turn
        self.timer_running = False
        self.transcripts: dict[int, str] = {}
        self.live_previews: dict[int, str] = {}
        self.evaluations: dict[int, dict] = {}

        # Turn-based speaking (1-minute per speaker)
        self.speaking_order: list[int] = []
        self.current_speaker_idx: int = 0
        self.turn_number: int = 0
        self.round: int = 1  # 1: Waiting, 2: Discussion (turn-based), 3: Complete
        self.alert_cooldowns: dict[int, set[str]] = {}
        self.last_activity_time: float = 0.0

        # Per-user turn results
        self.turn_scores: dict[int, list[dict]] = {}  # user_id -> list of turn score dicts

        # Readiness & device state
        self.ready_users: set[int] = set()
        self.mic_checks: dict[int, bool] = {}
        self.network_health: dict[int, str] = {}
        self.video_enabled: dict[int, bool] = {}  # user_id -> camera on/off
        self.mic_muted: dict[int, bool] = {}  # user_id -> muted or not

        # Turn tracking
        self.turn_start_time: float = 0.0
        self.turn_recording_chunks: dict[int, list] = {}  # user_id -> accumulated audio chunks for current turn

    def start_discussion(self):
        self.speaking_order = list(self.members.keys())
        import random
        random.shuffle(self.speaking_order)
        self.current_speaker_idx = 0
        self.turn_number = 0
        self.round = 2  # Active discussion
        self.timer_seconds = 60
        self.timer_running = False
        self.alert_cooldowns = {}
        import time
        self.last_activity_time = time.time()
        self.turn_start_time = time.time()
        self.finished_user_ids = set()
        self.all_finished = False
        self.turn_scores = {uid: [] for uid in self.members}
        self.video_enabled = {uid: True for uid in self.members}
        self.mic_muted = {uid: False for uid in self.members}
        self.turn_recording_chunks = {uid: [] for uid in self.members}

    def get_current_speaker_id(self) -> int | None:
        if self.current_speaker_idx < len(self.speaking_order):
            return self.speaking_order[self.current_speaker_idx]
        return None

    def advance_speaker(self) -> int | None:
        """Move to next speaker. Returns new speaker_id or None if all done."""
        self.current_speaker_idx += 1
        if self.current_speaker_idx >= len(self.speaking_order):
            self.round = 3
            self.all_finished = True
            self.timer_running = False
            return None
        self.turn_number += 1
        self.timer_seconds = 60
        self.timer_running = True
        import time
        self.turn_start_time = time.time()
        self.last_activity_time = time.time()
        return self.get_current_speaker_id()

    def snapshot(self) -> dict:
        return {
            "team_number": self.team_number,
            "topic": self.topic,
            "finished_user_ids": list(self.finished_user_ids),
            "all_finished": self.all_finished,
            "timer_seconds": self.timer_seconds,
            "timer_running": self.timer_running,
            "speaking_order": self.speaking_order,
            "current_speaker_idx": self.current_speaker_idx,
            "current_speaker_id": self.get_current_speaker_id(),
            "turn_number": self.turn_number,
            "round": self.round,
            "turn_scores": {str(k): v for k, v in self.turn_scores.items()},
            "video_enabled": self.video_enabled,
            "mic_muted": self.mic_muted,
            "members": [
                {
                    "user_id": uid,
                    "name": m.get("name"),
                    "label": m.get("label") or m.get("anonymous_label"),
                    "status": "finished" if uid in self.finished_user_ids else "speaking" if uid == self.get_current_speaker_id() else "waiting",
                    "video_enabled": self.video_enabled.get(uid, True),
                    "mic_muted": self.mic_muted.get(uid, False),
                }
                for uid, m in self.members.items()
            ],
        }


class RoomState:
    """Transient, in-memory state for one live session room."""

    def __init__(self, session_code: str, topic: str | None = None) -> None:
        self.session_code = session_code
        self.topic = topic
        self.paused = False
        self.ended = False
        self.participants: dict[int, dict] = {}
        self.team_states: dict[int, TeamState] = {}

    def ensure_team(self, team_number: int, topic: str, members: list[dict], speaking_time: int = 120) -> TeamState:
        if team_number not in self.team_states:
            self.team_states[team_number] = TeamState(team_number, topic, members, speaking_time)
        return self.team_states[team_number]

    def snapshot(self) -> dict:
        return {
            "topic": self.topic,
            "paused": self.paused,
            "ended": self.ended,
            "participants": [
                {
                    "user_id": uid,
                    "name": p.get("name"),
                    "label": p.get("label"),
                    "team_number": p.get("team_number"),
                    "status": p.get("status"),
                }
                for uid, p in self.participants.items()
            ],
            "teams": {tn: ts.snapshot() for tn, ts in self.team_states.items()},
        }


class ClientInfo:
    """Metadata attached to each connected WebSocket."""
    def __init__(self, ws: WebSocket, user_id: int, role: str, name: str | None, team_number: int | None = None):
        self.ws = ws
        self.user_id = user_id
        self.role = role
        self.name = name
        self.team_number = team_number


class GDLiveConnectionManager:
    """Holds active WebSocket connections keyed by session_code."""

    def __init__(self) -> None:
        self._rooms: dict[str, dict[int, ClientInfo]] = {}
        self._state: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()
        self._silence_tasks: dict[str, asyncio.Task] = {}

    async def connect(self, session_code: str, ws: WebSocket, user_id: int, role: str, name: str | None, team_number: int | None = None) -> None:
        async with self._lock:
            room = self._rooms.setdefault(session_code, {})
            room[id(ws)] = ClientInfo(ws, user_id, role, name, team_number)

    async def disconnect(self, session_code: str, ws: WebSocket) -> None:
        async with self._lock:
            room = self._rooms.get(session_code)
            if room:
                room.pop(id(ws), None)
                if not room:
                    self._rooms.pop(session_code, None)

    def get_user_team(self, session_code: str, user_id: int) -> int | None:
        room = self._rooms.get(session_code)
        if not room:
            return None
        for ci in room.values():
            if ci.user_id == user_id:
                return ci.team_number
        return None

    def set_client_teams(self, session_code: str, team_by_user: dict[int, int]) -> None:
        """Update the persisted team_number on each connected client after teams
        are assigned, so team-scoped broadcasts reach the right participants."""
        room = self._rooms.get(session_code)
        if not room:
            return
        for ci in room.values():
            if ci.user_id in team_by_user:
                ci.team_number = team_by_user[ci.user_id]
        # Keep the in-memory participant registry in sync too: REST-only host
        # flows (host-meeting without the ready auto-start) never update it.
        state = self._state.get(session_code)
        if state:
            for uid, tn in team_by_user.items():
                p = state.participants.get(uid)
                if p is not None:
                    p["team_number"] = tn

    def ensure_state(self, session_code: str, topic: str | None = None) -> RoomState:
        state = self._state.get(session_code)
        if state is None or state.ended:
            state = RoomState(session_code, topic)
            self._state[session_code] = state
        elif topic is not None:
            state.topic = topic
        return state

    def get_state(self, session_code: str) -> RoomState | None:
        return self._state.get(session_code)

    def drop_state(self, session_code: str) -> None:
        self._state.pop(session_code, None)

    async def send_personal(self, ws: WebSocket, event: str, payload: Any = None) -> None:
        try:
            await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
        except Exception as exc:
            logger.warning("send_personal failed: %s", exc)

    async def broadcast(self, session_code: str, event: str, payload: Any = None) -> None:
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values()]
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
            except Exception as exc:
                logger.warning("broadcast send failed: %s", exc)
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_code, ws)

    async def broadcast_to_team(self, session_code: str, team_number: int, event: str, payload: Any = None) -> None:
        """Broadcast only to WebSocket connections belonging to a specific team."""
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values() if ci.team_number == team_number or ci.role == "admin"]
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
            except Exception as exc:
                logger.warning("broadcast_to_team send failed: %s", exc)
                dead.append(ws)
        for ws in dead:
            await self.disconnect(session_code, ws)

    async def broadcast_to_admin(self, session_code: str, event: str, payload: Any = None) -> None:
        """Broadcast only to admin connections."""
        async with self._lock:
            room = self._rooms.get(session_code, {})
            targets = [ci.ws for ci in room.values() if ci.role == "admin"]
        for ws in targets:
            try:
                await ws.send_text(json.dumps({"event": event, "payload": payload}, default=str))
            except Exception as exc:
                logger.warning("broadcast_to_admin send failed: %s", exc)


manager = GDLiveConnectionManager()


_RELAY_EVENTS = {
    "RAISE_HAND",
    "READY",
    "CHAT_MESSAGE",
    "START_GD",
    "PAUSE_GD",
    "RESUME_GD",
    "END_GD",
    "RESET_TIMER",
    "MUTE_PARTICIPANT",
    "REMOVE_PARTICIPANT",
    "AUDIO_CHUNK",
    "SPEAKER_FINISHED",
    "LIVE_SPEECH",
    "SUBMIT_READY_STATUS",
    "WEBRTC_OFFER",
    "WEBRTC_ANSWER",
    "WEBRTC_ICE_CANDIDATE",
    "CAMERA_STATUS",
    "MIC_STATUS",
    "FINISH_EARLY",
}


@router.websocket("/{session_code}")
async def gd_live_socket(
    websocket: WebSocket,
    session_code: str,
    token: str | None = Query(default=None),
):
    user = _auth_user(token)
    if not user:
        await websocket.accept()
        await websocket.send_json({"event": "ERROR", "payload": {"detail": "Unauthorized"}})
        await websocket.close()
        return

    await websocket.accept()

    user_id = user["id"]
    role = user.get("role", "student")
    name = user.get("name")

    # Determine team_number from DB
    connection = None
    team_number = None
    try:
        connection = get_connection()
        participants = queries.get_live_participants(connection, session_code)
        for p in participants:
            if p["user_id"] == user_id:
                team_number = p.get("team_number")
                break
    except Exception as exc:
        logger.warning("WS team_number lookup failed: %s", exc)
    finally:
        if connection: _return(connection)

    await manager.connect(session_code, websocket, user_id, role, name, team_number)
    logger.warning("WS CONNECT uid=%s room=%s team=%s", user_id, session_code, team_number)

    # Build/sync room state from the database.
    connection = None
    try:
        connection = get_connection()
        session = queries.get_live_session_by_code(connection, session_code)
        topic = queries.get_live_team_topic(connection, session_code)
        participants_list = queries.get_live_participants(connection, session_code)
        teams_from_db = queries.get_live_teams(connection, session_code) if session else []
    except Exception as _exc:
        logger.warning("WS state build error: %s", repr(_exc))
        session, topic, participants_list, teams_from_db = None, None, [], []
    finally:
        if connection: _return(connection)

    state = manager.ensure_state(session_code, topic)
    state.ended = bool(session and session["status"] == "completed")
    for p in participants_list:
        uid = p["user_id"]
        state.participants.setdefault(uid, {})
        state.participants[uid].update(
            {
                "name": p.get("name"),
                "label": p.get("anonymous_label"),
                "team_number": p.get("team_number"),
                "status": p.get("status"),
            }
        )

    # Initialize TeamState for each team from DB
    speaking_time = session.get("speaking_time", 120) if session else 120
    team_topic_map = {t["team_number"]: t["topic"] for t in teams_from_db}
    for p in participants_list:
        tn = p.get("team_number")
        if tn and tn not in state.team_states:
            members = [m for m in participants_list if m.get("team_number") == tn]
            t_topic = team_topic_map.get(tn, topic or "")
            state.ensure_team(tn, t_topic, members, speaking_time=speaking_time)

    # Send snapshot
    await manager.send_personal(websocket, "STATE_SYNC", state.snapshot())

    # Broadcast presence
    await manager.broadcast(
        session_code,
        "PARTICIPANT_JOINED",
        {
            "user_id": user_id,
            "name": name,
            "role": role,
            "team_number": team_number,
            "label": state.participants.get(user_id, {}).get("label"),
        },
    )
    await broadcast_participants_with_checks(session_code, state)

    try:
        while True:
            data = await websocket.receive_json()
            event = data.get("event")
            payload = data.get("payload", {}) or {}

            # Teams are assigned AFTER students connect (host-meeting / ready
            # flow), so the connect-time team_number is stale (None). Re-resolve
            # from the in-memory participant registry on every event so
            # team-scoped handlers (LIVE_SPEECH, SPEAKER_FINISHED, AUDIO_CHUNK)
            # find the correct TeamState for pre-assignment connections.
            _pinfo = state.participants.get(user_id)
            _resolved_team = _pinfo.get("team_number") if _pinfo else None
            if _resolved_team is not None:
                team_number = _resolved_team

            # Handle binary audio chunks
            if event == "AUDIO_CHUNK":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    text = payload.get("text", "")
                    if text:
                        ts.transcripts.setdefault(user_id, "")
                        ts.transcripts[user_id] += text + " "
                continue

            if event == "LIVE_SPEECH":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    text = payload.get("text", "")
                    if text:
                        ts.live_previews.setdefault(user_id, "")
                        ts.live_previews[user_id] = text
                        if not ts.transcripts.get(user_id, "").strip():
                            ts.transcripts[user_id] = text
                        await manager.broadcast_to_team(session_code, team_number, "LIVE_SPEECH_BROADCAST", {
                            "user_id": user_id,
                            "text": text
                        })
                continue
            if event == "SPEAKER_FINISHED":
                ts = state.team_states.get(team_number) if team_number else None
                if ts:
                    current_speaker_id = ts.get_current_speaker_id()
                    if current_speaker_id == user_id:
                        transcript = payload.get("transcript", "").strip()
                        logger.info("[SPEAKER_FINISHED] uid=%s payload_transcript_len=%d", user_id, len(transcript))
                        if not transcript or len(transcript) < 5:
                            fallback = ts.transcripts.get(user_id, "").strip()
                            logger.info("[SPEAKER_FINISHED] Using fallback from ts.transcripts: len=%d preview=%s", len(fallback), fallback[:100])
                            transcript = fallback or "[No speech recorded]"

                        loop = asyncio.get_running_loop()
                        try:
                            result = await loop.run_in_executor(None, evaluate_transcript, transcript, None, ts.topic)
                            scores = _compute_scores_sync(result)
                        except Exception as exc:
                            logger.error("AI evaluation failed: %s", exc)
                            scores = {
                                "overall": 75.0, "fluency": 75.0, "grammar": 75.0,
                                "accent": 75.0, "relevance": 75.0, "quality": 75.0,
                                "points": 37.5,
                                "weaknesses": "Evaluation fallback", "tips": "Speak clearly and elaborate"
                            }
                            result = None

                        eval_data = {
                            "overall_score": float(scores["overall"]),
                            "grammar_score": float(result.grammar_score) if result else 75.0,
                            "confidence_score": float(result.confidence_score) if result else 75.0,
                            "fluency_score": float(result.fluency_score) if result else 75.0,
                            "vocabulary_score": float(result.vocabulary_score) if result else 75.0,
                            "pronunciation_score": float(result.pronunciation_score) if result else 75.0,
                        }
                        if result:
                            eval_data.update({
                                "strengths": result.strengths,
                                "weaknesses": result.weaknesses,
                                "recommendations": result.recommendations,
                                "feedback": result.feedback,
                            })
                        ts.evaluations[user_id] = eval_data
                        ts.finished_user_ids.add(user_id)

                        conn_eval = get_connection()
                        try:
                            turn_id = queries.save_turn(conn_eval, session_code, user_id, team_number, transcript, 60)
                            queries.complete_turn(conn_eval, turn_id)
                            queries.save_turn_evaluation(conn_eval, turn_id, eval_data)
                        except Exception as exc:
                            logger.error("DB save turn failed: %s", exc)
                        finally:
                            _return(conn_eval)

                        await manager.broadcast_to_team(session_code, team_number, "TURN_EVALUATED", {
                            "user_id": user_id,
                            "scores": eval_data,
                            "transcript": transcript,
