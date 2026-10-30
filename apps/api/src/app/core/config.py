"""AgentFlow config - pydantic-settings."""

from __future__ import annotations

import shutil
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py 位于 apps/api/src/app/core → parents[5] 才是仓库根
# （此前写成 parents[4]，数据目录因此落在 apps/data，评审 S13）
ROOT_DIR = Path(__file__).resolve().parents[5]  # AgentFlow/
DATA_DIR = ROOT_DIR / "data"


def relocate_legacy_data_dir(legacy: Path, target: Path) -> bool:
    """把旧位置的数据目录搬到新位置（一次性）。

    只在"新位置还没有库、旧位置有库"时动手，避免覆盖用户数据。
    返回是否发生了搬迁，便于调用方记录日志。
    """
    if not legacy.is_dir() or (target / "agentflow.db").exists():
        return False
    target.mkdir(parents=True, exist_ok=True)
    for item in legacy.iterdir():
        if item.is_file():
            shutil.move(str(item), str(target / item.name))
    shutil.rmtree(legacy, ignore_errors=True)
    return True


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

    @property
    def is_packaged(self) -> bool:
        """是否运行在 PyInstaller 冻结环境里（打包后必须由外层显式给 DATA_DIR）。"""
        import sys

        return bool(getattr(sys, "frozen", False))


settings = Settings()
