# Project Memory — MZ Orator (speaksense-ai-orion)

## Realtime "Host a Meeting" GD Workflow — 1-Minute Turn-Based Video GD

### Architecture Change (2026-08-06)
**OLD**: 7-stage GD with 10-minute speaking time, no video, anonymous participants.
**NEW**: 1-minute turn-based GD with live video (WebRTC), camera/mic controls, per-turn AI evaluation.

### Endpoints (backend, `http://localhost:8000`)
- `POST /gd-live/sessions/{session_code}/host-meeting` — admin hosts: assigns single team + topic, sets status `live`, broadcasts `SESSION_STARTED` (payload: topic, members). Returns `{ session_code, topic, members }`.
- `GET /gd-live/sessions/{session_code}/live-state` — returns current live room state (members, topic, status).
- `POST /gd-live/sessions/{session_code}/end-live` — sets status `completed`, broadcasts `SESSION_ENDED`.
- `GET /gd-live/sessions/{session_code}/turns` — per-turn history for session.
- `GET /gd-live/sessions/{session_code}/turn-analytics` — aggregated analytics (admin only).
- `WebSocket /ws/gd-live/{session_code}?token={jwt}` — realtime hub (`backend/realtime/gd_ws.py`, `GDLiveConnectionManager`).

### WebSocket Events
- Server → client: `SESSION_STARTED`, `SESSION_ENDED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `SPEAKER_CHANGED` (60s turn), `TURN_EVALUATED` (per-turn AI scores), `TEAM_STATE_UPDATED`, `CHAT_MESSAGE`, `CAMERA_STATUS`, `MIC_STATUS`, `LIVE_SPEECH_BROADCAST`, `STATE_SYNC`.
- Client → server: `WEBRTC_OFFER`, `WEBRTC_ANSWER`, `WEBRTC_ICE_CANDIDATE` (WebRTC signaling), `CAMERA_STATUS`, `MIC_STATUS`, `FINISH_EARLY`, `SPEAKER_FINISHED`, `LIVE_SPEECH`, `SUBMIT_READY_STATUS`.
- Admin-only: `START_GD`, `PAUSE_GD`, `RESUME_GD`, `END_GD`, `RESET_TIMER`, `MUTE_PARTICIPANT`, `REMOVE_PARTICIPANT`.

### DB Schema Additions
- `gd_live_turns` table: tracks per-turn data (session_code, user_id, team_number, turn_number, speaker_order, start_time, end_time, duration_seconds, video_enabled, audio_enabled, transcript, ai_completed, scores).
- `backend/database/queries.py`: `save_turn()`, `complete_turn()`, `save_turn_evaluation()`, `get_turns_for_session()`, `get_turns_for_user()`, `get_turn_analytics()`.

### Backend Changes
- `backend/realtime/gd_ws.py`: `TeamState` simplified to turn-based 60s system. `start_discussion()` sets random speaking order. `advance_speaker()` moves to next. `SPEAKER_FINISHED` handler runs AI evaluation per turn, saves to DB, broadcasts `TURN_EVALUATED`. WebRTC signaling relay for `WEBRTC_OFFER`/`ANSWER`/`ICE_CANDIDATE`.
- `backend/api/gd_live.py`: Added `/turns` and `/turn-analytics` endpoints.
- Auto-start: when all connected students mark ready (≥2), auto-hosts and begins first turn.

### Frontend (`http://localhost:3000`)
- `frontend/components/GdLiveRoom.tsx`:
  - **useWebRTC hook**: Manages local camera+mic via `getUserMedia({ video: true, audio: true })`, creates `RTCPeerConnection` per remote peer, handles WebRTC signaling via WS.
  - **Video Grid**: Responsive grid showing all participants' webcam feeds with name labels, speaking indicator (highlight border), camera/mic status icons.
  - **60-Second Timer**: Large `CircularTimer` countdown `00:59 → 00:00`. Auto-stops recording and submits at 0.
  - **Current Speaker Card**: Shows speaker name, turn number, "Finish Early" button.
  - **Control Bar**: Camera toggle, Mic toggle, Leave Room button.
  - **Turn Evaluation**: Shows score card briefly after each turn.
  - **Results View**: Shows final leaderboard and detailed scores after all turns complete.
  - Removed: 7-stage timeline, Floor Queues, Rebuttal Queue, Agree/Disagree, Consensus, Challenge Questions, Pipeline Tracker.
- `frontend/components/GdLiveAdminMonitor.tsx`: Updated for turn-based monitoring with analytics tab.
- `frontend/lib/useGdLiveWs.ts`: Added `WEBRTC_OFFER`, `WEBRTC_ANSWER`, `WEBRTC_ICE_CANDIDATE`, `TURN_EVALUATED`, `CAMERA_STATUS`, `MIC_STATUS`, `FINISH_EARLY` event types.
- `frontend/lib/api.ts`: Added `getTurnHistory()`, `getTurnAnalytics()`, types `TurnRecord`, `TurnAnalytics`.

### GD Discussion Flow (NEW)
1. Admin creates GD Live session → students join
2. Admin hosts meeting (or auto-start when all ready)
3. Students enter waiting room → mark ready → auto-start
4. **Turn 1**: First speaker gets 60 seconds with live video
5. Timer counts down 00:59 → 00:00
6. At 0:00 OR "Finish Early": recording stops, audio sent for AI evaluation
7. AI evaluates: grammar, fluency, pronunciation, confidence, vocabulary, overall score
8. Scores broadcast to all participants
9. **Turn 2**: Next speaker begins (60 seconds)
10. Repeat until all participants have spoken
11. Final results compiled and broadcast

### Run
- Backend: `cd speaksense-ai-orion; .\backend\venv\Scripts\Activate.ps1; python -m uvicorn backend.main:app --port 8000 --reload` (run from PROJECT ROOT).
- Frontend: `cd frontend; npm run dev`.

### Test flow
1. Admin creates a GD Live session → 2+ students join.
2. Admin hosts meeting → students auto-redirect to discussion room.
3. Students see video grid with all participants' webcams.
4. First speaker begins — 60s countdown timer visible.
5. At 60s or "Finish Early" → recording stops → AI evaluation runs → scores shown.
6. Next speaker begins automatically.
7. After all turns → final results leaderboard displayed.
8. Admin sees turn-by-turn analytics dashboard.
