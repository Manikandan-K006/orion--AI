# API Testing Guide

Base URL:

```text
http://localhost:8000
```

All endpoints except `/health`, `/register`, and `/login` require a Bearer token in the `Authorization` header.

---

## Health

```http
GET /health
```

Expected:

```json
{
  "status": "ok",
  "service": "SpeakSense AI"
}
```

---

## Register

```http
POST /register
```

Body:

```json
{
  "name": "Student One",
  "email": "student@example.com",
  "password": "Password123",
  "role": "student",
  "department": "Computer Science",
  "year": "Final Year"
}
```

Expected (HTTP 201):

```json
{
  "id": 1,
  "name": "Student One",
  "email": "student@example.com",
  "role": "student"
}
```

---

## Login

```http
POST /login
```

Body:

```json
{
  "email": "student@example.com",
  "password": "Password123"
}
```

Expected:

```json
{
  "access_token": "jwt-token",
  "token_type": "bearer"
}
```

---

## Profile (Protected)

```http
GET /profile
Authorization: Bearer <token>
```

Expected:

```json
{
  "id": 1,
  "name": "Student One",
  "email": "student@example.com",
  "role": "student"
}
```

---

## List Questions (Protected)

```http
GET /questions
Authorization: Bearer <token>
```

Expected:

```json
[
  {
    "id": 1,
    "question_text": "Tell me about yourself and your academic background.",
    "category": "introduction",
    "difficulty": "easy",
    "created_at": "2026-07-14T00:00:00"
  }
]
```

---

## Create Question (Admin only, Protected)

```http
POST /questions
Authorization: Bearer <token>
Content-Type: application/json

{
  "question_text": "Describe a time you led a team under tight deadlines.",
  "category": "behavioral",
  "difficulty": "hard"
}
```

Expected (HTTP 201):

```json
{
  "id": 5,
  "message": "Question added successfully"
}
```

Non-admin gets HTTP 403.

---

## Update Question (Admin only, Protected)

```http
PUT /questions/5
Authorization: Bearer <token>
Content-Type: application/json

{
  "question_text": "Describe a time you led a team under tight deadlines (updated).",
  "category": "behavioral",
  "difficulty": "hard"
}
```

Expected:

```json
{
  "message": "Question updated successfully"
}
```

---

## Delete Question (Admin only, Protected)

```http
DELETE /questions/5
Authorization: Bearer <token>
```

Expected:

```json
{
  "message": "Question deleted successfully"
}
```

---

## Create Interview Session (Protected)

```http
POST /interviews/sessions
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "Mock Interview - Round 1"
}
```

Expected (HTTP 201):

```json
{
  "id": 1,
  "title": "Mock Interview - Round 1",
  "status": "in_progress"
}
```

---

## List Interview Sessions (Protected)

```http
GET /interviews/sessions
Authorization: Bearer <token>
```

Expected:

```json
[
  {
    "id": 1,
    "student_id": 1,
    "title": "Mock Interview - Round 1",
    "status": "completed",
    "total_score": 85.63,
    "created_at": "...",
    "completed_at": "..."
  }
]
```

---

## Analyze Text Response (Protected)

```http
POST /interviews/analyze-text
Authorization: Bearer <token>
Content-Type: application/json

{
  "session_id": 1,
  "question_id": 1,
  "transcript": "I built a final year project where I designed the backend, improved the database queries, and presented the solution confidently."
}
```

Expected:

```json
{
  "response_id": 1,
  "analysis_id": 1,
  "analysis": {
    "grammar_score": 92.0,
    "pronunciation_score": 82.0,
    "fluency_score": 88.0,
    "confidence_score": 84.0,
    "vocabulary_score": 82.14,
    "emotion": "neutral",
    "overall_score": 85.63,
    "feedback": "..."
  }
}
```

---

## Upload Audio (Protected)

```http
POST /interviews/upload-audio
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <audio.wav>
```

Expected (HTTP 201):

```json
{
  "audio_path": "backend/uploads/1_abcdef01.wav",
  "transcript": "",
  "message": "Connect Whisper model here for production audio transcription"
}
```

Allowed file types: `.wav`, `.mp3`, `.m4a`, `.webm`.

---

## Get Progress (Protected)

```http
GET /progress
Authorization: Bearer <token>
```

Expected:

```json
{
  "student_id": 1,
  "average_score": 85.63,
  "interviews_completed": 1,
  "updated_at": "..."
}
```

If no interviews completed:

```json
{
  "student_id": 1,
  "average_score": 0,
  "interviews_completed": 0
}
```

---

## Generate Report (Protected)

```http
POST /reports/1
Authorization: Bearer <token>
```

Expected (HTTP 201):

```json
{
  "id": 1,
  "session_id": 1,
  "report_path": "reports\\interview_report_1.pdf",
  "summary": "Interview completed. Review communication scores and continue practicing targeted weak areas."
}
```

---

## Download Report (Protected)

```http
GET /reports/1/download
Authorization: Bearer <token>
```

Expected: PDF file download (`interview_report_1.pdf`).

Returns HTTP 404 JSON if report does not exist:

```json
{
  "detail": "Report not found. Generate it first via POST."
}
```
```
