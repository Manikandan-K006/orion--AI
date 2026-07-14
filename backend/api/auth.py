
from fastapi import APIRouter, Depends, HTTPException, status
from mysql.connector import MySQLConnection

from backend.database.db import get_db
from backend.database import queries
from backend.models.schemas import LoginRequest, RegisterNumberLogin, RegisterRequest, TokenResponse, UserResponse
from backend.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(tags=["Authentication"])


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, connection: MySQLConnection = Depends(get_db)) -> UserResponse:
    existing_user = queries.get_user_by_email(connection, payload.email)
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is already registered")

    user_id = queries.create_user(connection, payload.name, payload.email, hash_password(payload.password), payload.role)
    if payload.role == "student":
        queries.create_student_profile(connection, user_id, payload.department, payload.year)

    return UserResponse(id=user_id, name=payload.name, email=payload.email, role=payload.role)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, connection: MySQLConnection = Depends(get_db)) -> TokenResponse:
    user = queries.get_user_by_email(connection, payload.email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token({"sub": str(user["id"]), "role": user["role"]})
    return TokenResponse(access_token=token, user={
        "id": user["id"], "name": user["name"], "email": user["email"],
        "role": user["role"], "register_number": user.get("register_number", "")
    })


@router.post("/login/register-number", response_model=TokenResponse)
def login_by_register_number(payload: RegisterNumberLogin, connection: MySQLConnection = Depends(get_db)) -> TokenResponse:
    user = queries.get_user_by_register_number(connection, payload.register_number)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Register number not found. Contact admin.")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password")

    token = create_access_token({"sub": str(user["id"]), "role": user["role"]})
    return TokenResponse(access_token=token, user={
        "id": user["id"], "name": user["name"], "email": user["email"],
        "role": user["role"], "register_number": user["register_number"]
    })


@router.get("/profile", response_model=UserResponse)
def profile(current_user: dict = Depends(get_current_user)) -> UserResponse:
    return UserResponse(**current_user)
