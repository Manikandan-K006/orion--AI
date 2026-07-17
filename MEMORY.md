# Project Memory — MZ Orator (speaksense-ai-orion)

## Realtime "Host a Meeting" GD Workflow

### Endpoints (backend, `http://localhost:8000`)
- `POST /gd-live/sessions/{session_code}/host-meeting` — admin hosts: assigns single team + topic, sets status `live`, broadcasts `SESSION_STARTED` (payload: topic, members). Returns `{ session_code, topic, members }`.
- `GET /gd-live/sessions/{session_code}/live-state` — returns current live room state (members, topic, status).
- `POST /gd-live/sessions/{session_code}/end-live` — sets status `completed`, broadcasts `SESSION_ENDED`.
- `WebSocket /ws/gd-live/{session_code}?token={jwt}` — realtime hub (`backend/realtime/gd_ws.py`, `GDLiveConnectionManager`).

### WebSocket Events
- Server → client: `SESSION_STARTED`, `SESSION_ENDED`, `PARTICIPANT_JOINED`, `PARTICIPANT_LEFT`, `MIC_TOGGLED`, `CAMERA_TOGGLED`, `HAND_RAISED`, `SPEAKER_CHANGED`, `CHAT_MESSAGE`.
- Auth: JWT via `decode_token` (in `backend/security.py`).

### DB
- `gd_live_sessions.status` enum: `waiting`, `active`, `live`, `completed` (added `live`).
- `backend/database/queries.py`: `set_live_session_status`, `get_live_session_status`, `get_live_team_topic`, `assign_live_single_team`.

### Frontend (`http://localhost:3000`)
- `frontend/lib/api.ts`: `hostGdLiveMeeting`, `endGdLiveMeeting`, `getGdLiveState`, types `GDLiveRoomMember`, `GDLiveRoomState`.
- `frontend/lib/useGdLiveWs.ts`: WS hook (`connected`, `send`, `subscribe`).
- `frontend/components/GdLiveRoom.tsx`: full-screen live room (local camera + simulated video grid, mic/cam/hand/chat/fullscreen/leave controls, admin Start 15:00/10:00/End + countdown timer that auto-ends).
- `frontend/app/page.tsx`: `view === "gd-live-room"` renders `<GdLiveRoom>`; admin "Host a Meeting" button (enabled when `gdLiveParticipants.length >= 2`); `StudentLiveWaiter` component opens WS in student waiting view and auto-redirects to room on `SESSION_STARTED`.

### Run
- Backend: activate venv, `python -m uvicorn backend.main:app --port 8000 --reload`. Must restart to load new routes if not using reload.
- Frontend: `cd frontend; npm run dev`.

### Test flow
1. Admin creates a GD Live session → 2+ students join (register numbers 911724205001…061, pass `Password123`).
2. Admin participants view shows **Host a Meeting** (enabled when ≥2 joined).
3. Click → admin enters room; students auto-redirect via `SESSION_STARTED`.
4. Admin Start 15:00 / 10:00 / End; timer auto-ends. End redirects all back.
