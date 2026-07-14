# What To Do Next

## 1. Install MySQL

Install MySQL 8.0+ and create the database:

```powershell
# Recommended PowerShell command:
Get-Content database\schema.sql | mysql -u root -p
```

> **Note:** PowerShell does **not** support the `<` redirect operator for `mysql`. Use `Get-Content ... | mysql ...` instead.

## 2. Configure Backend

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
```

Edit `backend\.env`:
- Set `MYSQL_PASSWORD` to your MySQL root password
- Replace `JWT_SECRET_KEY` with a strong random secret

## 3. Start Backend

```powershell
uvicorn backend.main:app --reload
```

Swagger: http://localhost:8000/docs

## 4. Configure and Start Frontend

```powershell
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

Browser: http://localhost:3000

## 5. Verify Full Workflow

1. Register a student account
2. Login
3. View questions
4. Start an interview session
5. Write a transcript and analyze it
6. View progress chart
7. Generate and download PDF report
8. Upload audio file (optional)

## 6. Backend Testing

```powershell
.venv\Scripts\python -m pytest backend\tests -v
```

## 7. Frontend Build Check

```powershell
cd frontend
npm run build
```

## 8. Production Deployment

- Set `APP_ENV=production`
- Use a strong `JWT_SECRET_KEY`
- Disable FastAPI debug/reload
- Configure `MYSQL_*` for production database
- Use a process manager (NSSM, supervisor, systemd)
- Serve frontend via Next.js standalone or static export

## Completed Features

| Feature | Endpoint | Status |
|---------|----------|--------|
| Health check | `GET /health` | Done |
| User registration | `POST /register` | Done |
| User login | `POST /login` | Done |
| Profile | `GET /profile` | Done |
| List questions | `GET /questions` | Done |
| Create question (admin) | `POST /questions` | Done |
| Update question (admin) | `PUT /questions/{id}` | Done |
| Delete question (admin) | `DELETE /questions/{id}` | Done |
| Create session | `POST /interviews/sessions` | Done |
| List sessions | `GET /interviews/sessions` | Done |
| Analyze text | `POST /interviews/analyze-text` | Done |
| Upload audio | `POST /interviews/upload-audio` | Done |
| Get progress | `GET /progress` | Done |
| Generate report | `POST /reports/{session_id}` | Done |
| Download report | `GET /reports/{session_id}/download` | Done |

## Future Hardening (optional)

- Connect Whisper in `backend/ai/speech_recognition.py` for actual audio transcription
- Connect Librosa for audio duration, pause, and energy analysis in pronunciation/fluency
- Connect LanguageTool or Gramformer for deeper grammar checks
- Connect Transformers for stronger emotion detection
- Add admin dashboard for question management
- Add historical progress charts (over time)
- Add pagination to session/question lists
- Add email verification for registration
- Add CI/CD pipeline with GitHub Actions
- Configure college server deployment
