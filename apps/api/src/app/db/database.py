"""SQLAlchemy engine + session."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from alembic import command
from app.core.config import settings
from app.core.logger import log

connect_args = {}
if settings.effective_database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.effective_database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    echo=settings.DEBUG,
)


if settings.effective_database_url.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Iterator[Session]:
    """FastAPI dependency - request-scoped session."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    """启动时把库结构迁移到最新，并清理上次中断的运行。

    结构来源是 alembic（`alembic/versions/0001_baseline.py` 起），不再用
    `create_all`——否则模型与库会悄悄漂移，且没有回滚路径。
    """
    _upgrade_schema()
    _mark_interrupted_runs()


def _upgrade_schema() -> None:
    """执行 alembic upgrade head；老库（无 alembic_version）先 stamp 基线。"""
    api_root = Path(__file__).resolve().parents[3]  # apps/api
    ini = api_root / "alembic.ini"
    scripts = api_root / "alembic"

    if not ini.exists() or not scripts.exists():
        # 打包场景需随包携带 alembic 目录（M4-T2）；此处保留兜底但会告警
        from importlib import import_module

        log.warning("alembic 配置缺失，回退到 create_all 建表（打包时请提供 alembic 目录）")
        for feature in ("providers", "runs", "settings", "workflows"):
            import_module(f"app.modules.{feature}.models")
        Base.metadata.create_all(bind=engine)
        return

    cfg = AlembicConfig(str(ini))
    cfg.set_main_option("script_location", str(scripts))
    cfg.set_main_option("sqlalchemy.url", settings.effective_database_url)

    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        existing = set(inspect(conn).get_table_names())
        if existing and "alembic_version" not in existing:
            # 历史版本是 create_all 建的库：标记为 baseline，不重建、不动数据
            log.info("检测到历史库（无 alembic_version），标记为 baseline")
            command.stamp(cfg, "head")
        command.upgrade(cfg, "head")


def _mark_interrupted_runs() -> None:
    """后端重启后，之前处于 running 的运行不可能还在跑，统一标记失败。"""
    from datetime import datetime

    from sqlalchemy import update

    from app.modules.runs.models import NodeRun, Run

    now = datetime.utcnow()
    with SessionLocal() as session:
        session.execute(
            update(Run)
            .where(Run.status == "running")
            .values(status="failed", error="应用重启中断", finished_at=now)
        )
        session.execute(
            update(NodeRun)
            .where(NodeRun.status == "running")
            .values(status="cancelled", error="应用重启中断")
        )
        session.commit()
