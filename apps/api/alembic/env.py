"""Alembic env.py - generates migrations from SQLAlchemy Base metadata."""
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
from app.modules.auth import models as auth_models  # noqa: F401  SaaS
from app.modules.workflows import models  # noqa: F401
from app.modules.runs import models  # noqa: F401
from app.modules.providers import models  # noqa: F401
from app.modules.settings import models  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.effective_database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # 应用内启动时（db/database.py）会把已有的连接塞进 config.attributes，
    # 这样迁移和应用共用同一个 engine（WAL / foreign_keys PRAGMA 才生效）。
    injected = config.attributes.get("connection")
    if injected is not None:
        context.configure(
            connection=injected,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        return

    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
