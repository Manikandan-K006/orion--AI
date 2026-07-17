# Project Memory — MZ Orator (speaksense-ai-orion)

## Realtime "Host a Meeting" GD Workflow

### Endpoints (backend, `http://localhost:8000`)
- `POST /gd-live/sessions/{session_code}/host-meeting` — admin hosts: assigns single team + topic, sets status `live`, broadcasts `SESSION_STARTED` (payload: topic, members). Returns `{ session_code, topic, members }`.
- `GET /gd-live/sessions/{session_code}/live-state` — returns current live room state (members, topic, status).
- `POST /gd-live/sessions/{session_code}/end-live` — sets status `completed`, broadcasts `SESSION_ENDED`.
- `WebSocket /ws/gd-live/{session_code}?token={jwt}` — realtime hub (`backend/realtime/gd_ws.py`, `GDLiveConnectionManager`).

### WebSocket Events
- Server → client: `SESSION_CREATED`, `SESSION_STARTED`, `SESSION_PAUSED`, `SESSION_RESUMED`, `SESSION_ENDED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `SPEAKER_CHANGED`, `READY_STATUS`, `HAND_RAISED`, `CHAT_MESSAGE`, `ROUND_CHANGED`, `TIMER_UPDATED`, `PARTICIPANT_MUTED`, `PARTICIPANT_REMOVED`, `STATE_SYNC`.
- Admin-only relay events: `START_GD`, `PAUSE_GD`, `RESUME_GD`, `END_GD`, `NEXT_ROUND`, `NEXT_SPEAKER`, `RESET_TIMER`, `MUTE_PARTICIPANT`, `REMOVE_PARTICIPANT`, `SET_SPEAKER`.
- Auth: JWT via `decode_token` (in `backend/security.py`).

### DB
- `gd_live_sessions.status` enum: `waiting`, `active`, `live`, `completed` (added `live`).
- `backend/database/queries.py`: `set_live_session_status`, `get_live_session_status`, `get_live_team_topic`, `assign_live_single_team`.

### Frontend (`http://localhost:3000`)
- `frontend/lib/api.ts`: `hostGdLiveMeeting`, `endGdLiveMeeting`, `getGdLiveState`, types `GDLiveRoomMember`, `GDLiveRoomState`.
- `frontend/lib/useGdLiveWs.ts`: WS hook (`connected`, `send`, `subscribe`, auto-reconnect).
- `frontend/components/GdLiveRoom.tsx`: full-screen discussion workspace (NO camera/video). 3 panels: Participants (left), Discussion (center: topic/instructions/round/remaining/online/speaking queue), Live Activity (right). Top bar: LIVE, topic, code, timer, online, current speaker. Bottom: Raise Hand, Ready, Send Message, + admin controls (Start 15:00/10:00, Reset, Pause, Resume, Next Round, Next Speaker, End, and per-participant mute/remove/set-speaker in left panel).
- `frontend/app/page.tsx`:
  - Admin "Host a Meeting" → `hostGdLiveRoom` keeps admin on `gd-live-admin-view` (participant cards ALWAYS visible), sets `gdLiveRoomActive` and renders `<GdLiveAdminPanel>` (inline realtime controls + live activity + "Open Discussion Room"). Cards never disappear.
  - Student waiting (`gd-live-session`) renders `StudentLiveWaiter` (WS → redirect on `SESSION_STARTED`) AND `StudentLivePoller` (polls `/live-state`, redirects when `status==="live"`). Both call `enterGdLiveRoom` → `view="gd-live-room"`.
  - `enterGdLiveRoom` sets `gdLiveIsLiveMeeting=true`; guards `loadGdLiveTeamInfo`/`startGdLivePrep` so the OLD prep/speak recording flow does NOT hijack a hosted (live) meeting.
  - Camera fully removed: no `startLocalCamera`/`stopLocalCamera`, no `getUserMedia(video)`, no `<video>`.

### Run
- Backend: `cd speaksense-ai-orion; .\backend\venv\Scripts\Activate.ps1; python -m uvicorn backend.main:app --port 8000 --reload` (run from PROJECT ROOT, not inside backend/).
- Frontend: `cd frontend; npm run dev`.

### Test flow
1. Admin creates a GD Live session → 2+ students join (register numbers 911724205001…061, pass `Password123`).
2. Admin participants view shows **Host a Meeting** (enabled when ≥2 joined); cards stay visible.
3. Click → admin stays on participant page with LIVE panel; students auto-redirect to discussion room via WS `SESSION_STARTED` (polling fallback if WS missed).
4. Admin Start 15:00 / Pause / Resume / Next Round / Next Speaker / End. End redirects all back. No camera prompts.
