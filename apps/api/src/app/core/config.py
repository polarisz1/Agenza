"""AgentFlow config - pydantic-settings."""

from __future__ import annotations

import shutil
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.defaults import DEFAULT_HOST, DEFAULT_LOG_LEVEL, DEFAULT_PORT

# config.py 位于 apps/api/src/app/core → parents[5] 才是仓库根
# （此前写成 parents[4]，数据目录因此落在 apps/data，评审 S13）
ROOT_DIR = Path(__file__).resolve().parents[5]  # AgentFlow/
DATA_DIR = ROOT_DIR / "data"
# `.env` 按**绝对路径**定位到 apps/api/.env（评审 G19）：
# 相对路径依赖启动时的 cwd，`pnpm dev`、`uv run --directory`、Electron 拉起
# 三种方式 cwd 各不相同，相对路径会让同一份配置时而生效、时而静默失效。
APP_DIR = Path(__file__).resolve().parents[3]  # apps/api
ENV_FILE = APP_DIR / ".env"


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
    HOST: str = DEFAULT_HOST
    PORT: int = DEFAULT_PORT

    # ---- CORS ----
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # ---- Database ----
    DATABASE_URL: str = ""

    # ---- Directories ----
    DATA_DIR: str = str(DATA_DIR)
    # 打包后由外层（Electron / 命令行）注入：目录下含 frontend-dist/ 与 alembic/
    # 为空表示开发态，所有资源按仓库布局推算
    RESOURCE_DIR: str = ""
    # SECRET_FILE is derived at runtime; not a BaseSettings field
    # (avoids class-body eval when DATA_DIR is still str)

    @property
    def secret_file(self) -> str:
        return str(Path(self.DATA_DIR) / ".secret.key")

    @property
    def resource_root(self) -> Path | None:
        """随包资源根目录。

        1. `--resource-dir` / `RESOURCE_DIR` 显式指定（onedir / 外置资源）
        2. 单文件（onefile）运行时，PyInstaller 会把 `--add-data` 的内容解压到
           `sys._MEIPASS`，那里就是资源根目录
        """
        if self.RESOURCE_DIR:
            path = Path(self.RESOURCE_DIR)
            return path if path.is_dir() else None

        if self.is_packaged:
            import sys

            meipass = getattr(sys, "_MEIPASS", None)
            if meipass:
                extracted = Path(meipass)
                if extracted.is_dir():
                    return extracted

        return None

    @property
    def frontend_dist(self) -> Path:
        """前端产物目录：资源目录优先（打包态），否则回退到仓库布局（开发态）。

        评审 B5/②：此前 main.py 用 `__file__` 推算，冻结后指向 `_MEIPASS` 内部，必然 404。
        """
        root = self.resource_root
        if root is not None and (root / "frontend-dist").is_dir():
            return root / "frontend-dist"
        return ROOT_DIR / "apps" / "web" / "dist"

    @property
    def alembic_ini(self) -> Path:
        """alembic.ini：资源目录优先，否则仓库内的 apps/api/alembic.ini。"""
        root = self.resource_root
        if root is not None and (root / "alembic.ini").is_file():
            return root / "alembic.ini"
        return ROOT_DIR / "apps" / "api" / "alembic.ini"

    @property
    def alembic_dir(self) -> Path:
        """迁移脚本目录：资源目录优先，否则仓库内的 apps/api/alembic。"""
        root = self.resource_root
        if root is not None and (root / "alembic").is_dir():
            return root / "alembic"
        return ROOT_DIR / "apps" / "api" / "alembic"

    # ---- Engine ----
    ENGINE_MAX_CONCURRENCY: int = 4
    RUN_RETENTION: int = 200
    DEFAULT_TIMEOUT: int = 120
    # 跑用户脚本用的解释器；留空表示走默认解析（打包态=资源目录里的 pyemb，开发态=当前解释器）
    PYTHON_BIN: str = ""

    # ---- Frontend ----
    MOUNT_FRONTEND: bool = False

    # ---- Logging ----
    LOG_LEVEL: str = DEFAULT_LOG_LEVEL

    model_config = SettingsConfigDict(
        # 先读 cwd 的 .env（兼容"就地写一份配置"的用法），再用 apps/api/.env 覆盖：
        # 后者是仓库里唯一被文档和 .env.example 承认的位置，优先级更高。
        env_file=(".env", str(ENV_FILE)),
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
