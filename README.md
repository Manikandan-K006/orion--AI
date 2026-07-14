<<<<<<< HEAD
# SpeakSense AI

SpeakSense AI is a college final-year project for interview communication assessment. It uses a FastAPI backend, MySQL database, modular AI analysis files, and a Next.js frontend.

## Stack

- Frontend: Next.js 15, TypeScript, Tailwind CSS, shadcn-style components, Recharts
- Backend: FastAPI, Python 3.12, JWT, mysql-connector-python, raw SQL
- Database: MySQL
- AI modules: reusable Python modules under `backend/ai/`
- Reports: ReportLab PDF generation

## Project Structure

```text
frontend/
backend/
database/
docs/
```

## Implemented

- MySQL schema for all required tables
- Raw SQL query layer in `backend/database/queries.py`
- MySQL connection in `backend/database/db.py`
- JWT authentication (register, login, profile)
- `POST /register` - student/admin registration
- `POST /login` - returns JWT bearer token
- `GET /profile` - current user info
- `GET /questions`, `POST /questions` - list and create (admin-only)
- `PUT /questions/{id}`, `DELETE /questions/{id}` - admin question management
- `POST /interviews/sessions`, `GET /interviews/sessions` - session CRUD
- `POST /interviews/analyze-text` - AI text analysis with 5 scoring dimensions
- `POST /interviews/upload-audio` - audio file upload with transcription
- `GET /progress` - student progress with average score and completion count
- `POST /reports/{session_id}` - PDF report generation (ReportLab)
- `GET /reports/{session_id}/download` - download generated PDF
- `GET /health` - system health check
- Protected endpoints via JWT Bearer token
- Reusable AI module structure (grammar, fluency, confidence, vocabulary, pronunciation, emotion, speech recognition)
- Automatic progress recalculation after each completed analysis
- Text transcript assessment flow
- PDF report generation
- Next.js UI connected to backend APIs
- Progress display with chart
- Audio upload with transcription UI
- Report generation and download UI
- Admin role support

## Backend Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
```

Edit `.env` and set the MySQL username, password, database, and a strong `JWT_SECRET_KEY`.

Create the database:

```bash
mysql -u root -p < database\schema.sql
```

Run the backend:

```bash
uvicorn backend.main:app --reload
```

Swagger will be available at:

```text
http://localhost:8000/docs
```

## Frontend Setup

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Open:

```text
http://localhost:3000
```

## First Test Flow

1. Start MySQL.
2. Import `database/schema.sql`.
3. Start FastAPI.
4. Open Swagger and test `/health`.
5. Register a student using `/register`.
6. Login using `/login`.
7. Authorize Swagger with the returned bearer token.
8. Open the frontend.
9. Login or register.
10. Start a session.
11. Select a question.
12. Paste a transcript.
13. Run analysis.
14. Generate a report through `POST /reports/{session_id}`.

## Important Notes

- Do not put SQL in API routes.
- Do not use ORM libraries.
- Keep AI logic inside `backend/ai/`.
- Replace the current text fallback analyzers with full Whisper, Librosa, LanguageTool, and Transformers implementations during Phase 2 hardening.
- Never deploy with the example JWT secret.
=======
# orion--AI
>>>>>>> a5512fda9a039c44e44a585953a259dad81f3386
