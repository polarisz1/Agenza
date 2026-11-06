"""Alembic env.py - generates migrations from SQLAlchemy Base metadata.

DB-03：同时支持 SQLite（本地开发 / 桌面版）与 PostgreSQL（SaaS）；
PostgreSQL 下保留原生 UUID / JSONB 能力，并由迁移自行使用
`CREATE INDEX CONCURRENTLY`（见 app/db/pg.py）。
"""

from logging.config import fileConfig
from pathlib import Path
import sys

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make apps/api/src importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from app.core.config import settings  # noqa: E402
from app.db.database import Base  # noqa: E402

# Import all models so metadata.collect() picks them up
from app.modules.audit import models as audit_models  # noqa: F401  SaaS
from app.modules.auth import models as auth_models  # noqa: F401  SaaS
from app.modules.workflows import models  # noqa: F401
from app.modules.runs import models  # noqa: F401
from app.modules.providers import models  # noqa: F401
from app.modules.settings import models  # noqa: F401
from app.modules.triggers import models as trigger_models  # noqa: F401
from app.modules.gateway import models as gateway_models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.effective_database_url)

target_metadata = Base.metadata


def _configuration(connection) -> dict:
    """按方言生成 context.configure 参数。

    SQLite 的 ALTER TABLE 能力有限，需要 batch 模式；PostgreSQL 不使用 batch，
    否则 autogenerate 的 DDL 会被包成多余的重建流程。
    """
    is_sqlite = connection.dialect.name == "sqlite"
    return {
        "connection": connection,
        "target_metadata": target_metadata,
        "render_as_batch": is_sqlite,
        # 迁移审查时能发现列类型/默认值漂移（DB-03）
        "compare_type": True,
        "compare_server_default": True,
    }


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # 应用内启动时（db/database.py）会把已有的连接塞进 config.attributes，
    # 这样迁移和应用共用同一个 engine（WAL / foreign_keys PRAGMA 才生效）。
    injected = config.attributes.get("connection")
    if injected is not None:
        context.configure(**_configuration(injected))
        with context.begin_transaction():
            context.run_migrations()
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(**_configuration(connection))
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
