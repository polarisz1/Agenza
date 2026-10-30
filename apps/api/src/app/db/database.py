"""SQLAlchemy engine + session."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import settings

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
    """Create all tables on startup and clean up interrupted runs."""
    from importlib import import_module

    # 副作用导入：把各 feature 的 models 注册到 Base.metadata 后再建表
    for feature in ("providers", "runs", "settings", "workflows"):
        import_module(f"app.modules.{feature}.models")

    Base.metadata.create_all(bind=engine)
    _ensure_node_run_columns()
    _mark_interrupted_runs()


def _ensure_node_run_columns() -> None:
    """给已有的本地库补上新增列（SQLite/Postgres 都支持 ADD COLUMN）。"""
    from sqlalchemy import inspect, text

    columns = {col["name"] for col in inspect(engine).get_columns("node_run")}
    with engine.begin() as conn:
        if "started_at" not in columns:
            conn.execute(text("ALTER TABLE node_run ADD COLUMN started_at TIMESTAMP"))
        if "finished_at" not in columns:
            conn.execute(text("ALTER TABLE node_run ADD COLUMN finished_at TIMESTAMP"))


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
