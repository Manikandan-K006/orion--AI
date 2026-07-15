from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SpeakSense AI"
    app_env: str = "development"
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120

    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = ""
    mysql_database: str = "speaksense_ai"

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    sendgrid_api_key: str = ""
    sendgrid_from_email: str = "noreply@mzorator.com"
    frontend_url: str = "https://orion-ai-gamma.vercel.app"

    upload_dir: str = "uploads"
    report_dir: str = "reports"

    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()
