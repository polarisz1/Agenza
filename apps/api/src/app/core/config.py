"""AgentFlow config - pydantic-settings."""

from __future__ import annotations

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[4]  # AgentFlow/
DATA_DIR = ROOT_DIR / "data"


class Settings(BaseSettings):
    # ---- Application ----
    APP_NAME: str = "AgentFlow"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # ---- Server ----
    HOST: str = "127.0.0.1"
    PORT: int = 8000

    # ---- CORS ----
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # ---- Database ----
    DATABASE_URL: str = ""

    # ---- Directories ----
    DATA_DIR: str = str(DATA_DIR)
    # SECRET_FILE is derived at runtime; not a BaseSettings field
    # (avoids class-body eval when DATA_DIR is still str)

    @property
    def secret_file(self) -> str:
        return str(Path(self.DATA_DIR) / ".secret.key")

    # ---- Engine ----
    ENGINE_MAX_CONCURRENCY: int = 4
    RUN_RETENTION: int = 200
    DEFAULT_TIMEOUT: int = 120

    # ---- Frontend ----
    MOUNT_FRONTEND: bool = False

    # ---- Logging ----
    LOG_LEVEL: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors(cls, v):
        if isinstance(v, str):
            try:
                import json

                return json.loads(v)
            except Exception:
                return [o.strip() for o in v.split(",")]
        return v

    @property
    def effective_database_url(self) -> str:
        """Resolve DATABASE_URL - default to SQLite in DATA_DIR."""
        if self.DATABASE_URL:
            return self.DATABASE_URL
        data = Path(self.DATA_DIR)
        data.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{data / 'agentflow.db'}"


settings = Settings()
