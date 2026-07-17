# Project Memory — MZ Orator (SpeakSense AI / Orion)

## Objective
Maintain and enhance MZ Orator (AI GD evaluation, solo practice, anonymous GD Live). Local-first dev with college-network IP restriction. Redesigning the entire frontend from glassmorphism to an Enterprise SaaS design system (Vercel/Linear/Stripe style): solid surfaces, visible borders, shadows in BOTH light and dark themes.

## Critical Environment
- MySQL: host `mysql-3ac81cc6-project-orion.j.aivencloud.com` port 15901, user `avnadmin`, password <REACTED>, db `speaksense_ai` (20 tables).
- 61 IT students seeded 3rd Year, default password `Password123`. Admin: SPR `12345` / `Mzorator@admin` (role `admin`).
- Backend local: `http://localhost:8000`; frontend local: `http://localhost:3000`; Render backend `https://orion-ai-2udw.onrender.com`; Vercel `https://orion-ai-gamma.vercel.app`.
- `frontend/lib/api.ts` `API_URL` hardcoded `http://localhost:8000` — Vercel build breaks unless reverted or uses `NEXT_PUBLIC_API_URL`.
- **Run locally (manual, two terminals)**: backend `.\.venv\Scripts\Activate.ps1; python -m uvicorn backend.main:app --port 8000`; frontend `cd frontend; npm run dev`. NOTE: real venv is project-root `.venv`, NOT `backend\venv`. `start-local.ps1` is WRONG (points at backend\venv) — do not use as-is.
- Theme persisted in `localStorage` key `mzgd_theme`, defaults to `dark`, `darkMode:"class"`.

## Completed Work
- IP whitelist fix: `IPFilterMiddleware` in `backend/main.py` now always allows loopback (`127.0.0.1`/`::1`/`localhost`/`""`) in `allowed_list`; college restriction preserved via `ALLOWED_IPS` env (currently `103.207.1.89`). Login works locally (HTTP 200 on `/login/register-number`).
- New light login BG: `frontend/public/new_light_BG.jpeg` (user download). Login light bg = `/new_light_BG.jpeg`, dark = `/login_dark_bg.jpeg`.
- **Full Enterprise SaaS redesign COMPLETE** (all glassmorphism removed, verified by grep 0 matches for backdrop-blur/bg-white/[0/glass/rgba(255,255,255/text-black dark:text-white/text-gray-800 across app/):
  - `frontend/app/globals.css`: all CSS variables (`--bg --surface --surface-2 --surface-hover --border --border-strong --heading --body --muted --shadow-card --shadow-card-hover --table-* --input-bg --input-border --focus --btn-secondary-*`) + component classes (`.card .surface .surface-2 .card-hover .btn-primary .btn-secondary .inp .ent-table .pill .pill-active .icon-badge .icon-{purple,blue,green,orange,cyan,amber,red} .divider .animate-fade-up`). Added global `border-color: var(--border)` so standalone `border` is theme-aware.
  - `frontend/tailwind.config.ts`: `darkMode:"class"`, `borderRadius.card=20px`, `boxShadow.card`/`card-dark`, kept legacy color tokens (harmless, overridden by CSS vars).
  - `frontend/components/ui/button.tsx`: `primary`→`.btn-primary`, `secondary`→`.btn-secondary`, `ghost`→transparent hover surface-2.
  - `frontend/app/page.tsx`: login rewritten to solid `.card`+`.btn-*`+`.inp`+icon badge (no image bleed); app shell uses var(--surface)/var(--border), bg images removed; all glass cards→`.card`; tables→`.ent-table`; text tokens → text-heading/body/muted-soft; inputs→`.inp`; progress ring stroke uses var(--border-strong).
  - `npm run build` passes (compiled successfully, types valid). `npx tsc --noEmit` clean.

## Pending / Next
- (none blocking) Optional: Framer Motion fade-up/hover on key cards; visual verify light+dark on login/dashboard/leaderboard/gd-live/solo.
- Fix/remove `start-local.ps1` wrong venv path (`.venv` vs `backend\venv`).
- If deploying to Vercel: switch `frontend/lib/api.ts` to `NEXT_PUBLIC_API_URL` or revert to localhost.

## Key Files
- `frontend/app/page.tsx` — all UI views (login, dashboard, leaderboard, solo, gd-live, gd-live-admin, gd-live-session, gd-live-results)
- `frontend/app/globals.css` — design tokens + classes
- `frontend/tailwind.config.ts` — darkMode class, card tokens
- `frontend/components/ui/button.tsx` — Button variants
- `frontend/lib/api.ts` — API_URL
- `backend/main.py` — IPFilterMiddleware (loopback allowed)
- `backend/config.py` — allowed_ips; `backend/.env` — ALLOWED_IPS=103.207.1.89
