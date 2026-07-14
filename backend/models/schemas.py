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


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str


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
