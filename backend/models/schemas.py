from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="student", pattern="^(student|admin)$")
    department: str | None = Field(default=None, max_length=100)
    year: str | None = Field(default=None, max_length=30)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterNumberLogin(BaseModel):
    register_number: str = Field(min_length=3, max_length=20)
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict | None = None


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    register_number: str | None = None
    department: str | None = None
    year: str | None = None



class QuestionCreate(BaseModel):
    question_text: str = Field(min_length=10, max_length=1000)
    category: str = Field(default="general", max_length=100)
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$")


class QuestionUpdate(BaseModel):
    question_text: str = Field(min_length=10, max_length=1000)
    category: str = Field(default="general", max_length=100)
    difficulty: str = Field(default="medium", pattern="^(easy|medium|hard)$")


class SessionCreate(BaseModel):
    title: str = Field(default="Mock Interview", min_length=3, max_length=150)


class TextAnalysisRequest(BaseModel):
    session_id: int
    question_id: int
    transcript: str = Field(min_length=1, max_length=10000)


class AnalysisResult(BaseModel):
    grammar_score: float
    pronunciation_score: float
    fluency_score: float
    confidence_score: float
    vocabulary_score: float
    emotion: str
    overall_score: float
    feedback: str


class GDSessionCreate(BaseModel):
    topic_id: int
    team_size: int = Field(default=2, ge=1, le=4)


class GDTranscriptSubmit(BaseModel):
    transcript: str = Field(min_length=10)


class GDLeaderboardEntry(BaseModel):
    user_id: int
    name: str
    register_number: str
    overall_score: float
    fluency_score: float
    grammar_score: float
    accent_score: float
    relevance_score: float
    content_quality_score: float
    credential_points: float
    rank_position: int
