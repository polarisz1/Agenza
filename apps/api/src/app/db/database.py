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
from app.core.time import utcnow

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
    _relocate_legacy_data()
    _upgrade_schema()
    _mark_interrupted_runs()


def _relocate_legacy_data() -> None:
    """把历史上落在 apps/data 的库与主密钥搬到仓库根的 data/（评审 S13 / D-3）。

    只在"使用默认数据目录"时执行：测试与 Electron 会显式指定 DATA_DIR，
    此时绝不能去动仓库里的旧目录。
    """
    from app.core.config import DATA_DIR as DEFAULT_DATA_DIR
    from app.core.config import ROOT_DIR, relocate_legacy_data_dir

    target = Path(settings.DATA_DIR)
    if target.resolve() != DEFAULT_DATA_DIR.resolve():
        return

    legacy = ROOT_DIR / "apps" / "data"
    if relocate_legacy_data_dir(legacy, target):
        log.info(f"已把历史数据目录 {legacy} 迁移到 {target}")


def _upgrade_schema() -> None:
    """执行 alembic upgrade head；老库（无 alembic_version）先 stamp 基线。

    迁移目录优先取注入的资源目录（打包态），否则用仓库布局（开发态）——
    此前按 `__file__` 推算，冻结后找不到就会静默回退 create_all，升级路径断掉。
    """
    ini = settings.alembic_ini
    scripts = settings.alembic_dir

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
            # 历史版本是 create_all 建的库：stamp head 后不会重跑 upgrade，
            # 但早期 create_all 只建了 baseline (0001) 的表/列，后续迁移
            # (0002 索引、0003 workflow_version 表 + run.version 列) 会被跳过。
            # 这里在 stamp 之前手动补齐这些"增量 schema 变更"。
            log.info("检测到历史库（无 alembic_version），补全增量 schema 后标记 head")
            _backfill_delta_schema(conn)
            command.stamp(cfg, "head")
        command.upgrade(cfg, "head")


def _backfill_delta_schema(conn) -> None:
    """给 create_all 建的老库补上 0002/0003 迁移里新增的结构。

    为什么不用 stamp 0001 再 upgrade？因为 0001 的 upgrade() 会 create_table，
    遇到已存在的表会抛异常。这里用纯 SQL + SQLAlchemy inspect 按需补齐，
    不依赖 Alembic op（它需要 MigrationContext 绑定到我们的 conn）。
    """
    from sqlalchemy import text

    insp = inspect(conn)

    # ---- 0002: run 表的部分唯一索引 ----
    existing_indexes = {idx["name"] for idx in insp.get_indexes("run")}
    if "uq_run_running_per_workflow" not in existing_indexes:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX uq_run_running_per_workflow "
                "ON run (workflow_id) WHERE status = 'running'"
            )
        )
        log.info("补上 0002 迁移: run.uq_run_running_per_workflow 索引")

    # ---- 0003: workflow_version 表 + run.version 列 ----
    tables = set(insp.get_table_names())
    if "workflow_version" not in tables:
        conn.execute(
            text(
                """
                CREATE TABLE workflow_version (
                    id VARCHAR(24) PRIMARY KEY NOT NULL,
                    workflow_id VARCHAR(12) NOT NULL,
                    seq INTEGER NOT NULL,
                    summary VARCHAR(200),
                    graph_json TEXT NOT NULL,
                    viewport_json TEXT,
                    created_at DATETIME
                )
                """
            )
        )
        conn.execute(
            text(
                "CREATE INDEX ix_workflow_version_workflow_id "
                "ON workflow_version (workflow_id)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX uq_workflow_version_seq "
                "ON workflow_version (workflow_id, seq)"
            )
        )
        log.info("补上 0003 迁移: workflow_version 表")

    run_cols = {c["name"] for c in insp.get_columns("run")}
    if "version_id" not in run_cols:
        conn.execute(text("ALTER TABLE run ADD COLUMN version_id VARCHAR(24)"))
        log.info("补上 0003 迁移: run.version_id 列")
    if "version_seq" not in run_cols:
        conn.execute(text("ALTER TABLE run ADD COLUMN version_seq INTEGER"))
        log.info("补上 0003 迁移: run.version_seq 列")


def _mark_interrupted_runs() -> None:
    """后端重启后，之前处于 running 的运行不可能还在跑，统一标记失败。"""

    from sqlalchemy import update

    from app.modules.runs.models import NodeRun, Run

    now = utcnow()
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
