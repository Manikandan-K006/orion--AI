import hashlib
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from mysql.connector import MySQLConnection

from backend.config import get_settings
from backend.database.db import get_db
from backend.database import queries


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")


def hash_password(password: str) -> str:
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return salt.hex() + ":" + key.hex()


def verify_password(plain_password: str, password_hash: str) -> bool:
    salt_hex, key_hex = password_hash.split(":")
    salt = bytes.fromhex(salt_hex)
    stored_key = bytes.fromhex(key_hex)
    new_key = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, 100000)
    return new_key == stored_key


def create_access_token(data: dict[str, Any]) -> str:
    settings = get_settings()
    payload = data.copy()
    expires_at = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    payload.update({"exp": expires_at})
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    return payload


def get_current_user(
    token: str = Depends(oauth2_scheme),
    connection: MySQLConnection = Depends(get_db),
) -> dict[str, Any]:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise credentials_error

    user = queries.get_user_by_id(connection, user_id)
    if not user:
        raise credentials_error
    return user
