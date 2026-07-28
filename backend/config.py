import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent


def _load_env_file() -> dict[str, str]:
    env: dict[str, str] = {}
    for candidate in (_BACKEND_DIR.parent / ".env", _BACKEND_DIR / ".env"):
        if candidate.is_file():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, _, value = line.partition("=")
                    env[key.strip()] = value.strip()
    return env


class Settings(BaseSettings):
    app_name: str = "SpeakSense AI"
    app_env: str = "development"
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 120

    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = ""
    mysql_database: str = "speaksense_ai"

    sendgrid_api_key: str = ""
    sendgrid_from_email: str = "noreply@mzorator.com"
    frontend_url: str = "https://orion-ai-gamma.vercel.app"

    upload_dir: str = "uploads"
    report_dir: str = "reports"

    allowed_ips: str = ""
    network_restriction_enabled: str = "true"

    model_config = SettingsConfigDict(
        env_file=(str(_BACKEND_DIR.parent / ".env"), str(_BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def model_post_init(self, __context: object) -> None:
        env_file = _load_env_file()
        env_os = os.environ

        self.mysql_host = env_os.get("DB_HOST", env_file.get("DB_HOST", self.mysql_host))
        self.mysql_port = int(env_os.get("DB_PORT", env_file.get("DB_PORT", str(self.mysql_port))))
        self.mysql_user = env_os.get("DB_USER", env_file.get("DB_USER", self.mysql_user))
        self.mysql_password = env_os.get("DB_PASSWORD", env_file.get("DB_PASSWORD", self.mysql_password))
        self.mysql_database = env_os.get("DB_NAME", env_file.get("DB_NAME", self.mysql_database))

    @property
    def ssl_enabled(self) -> bool:
        env_file = _load_env_file()
        val = os.environ.get("DB_SSL", env_file.get("DB_SSL", "false"))
        return val.strip().lower() == "true"


@lru_cache
def get_settings() -> Settings:
    return Settings()
