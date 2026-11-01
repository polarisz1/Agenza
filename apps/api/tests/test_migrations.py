"""数据库迁移单测：空库建表、老库 stamp、重复执行幂等。

历史背景（评审 B4）：版本没有 alembic baseline，建表靠 create_all + 手写 ALTER，
任何字段变更都是破坏性升级。这里固定三种入口的行为。
"""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.db import database
from app.db.database import Base

# 确保模型已注册到 metadata（老库模拟要用 create_all）
from app.modules.providers import models as _provider_models  # noqa: F401
from app.modules.runs import models as _run_models  # noqa: F401
from app.modules.settings import models as _setting_models  # noqa: F401
from app.modules.workflows import models as _workflow_models  # noqa: F401

EXPECTED_TABLES = {"workflow", "run", "node_run", "provider", "app_setting", "alembic_version"}


def _expected_head() -> str:
    """从迁移脚本目录推当前 head，避免每加一版就要改测试里的硬编码。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from app.core.config import settings

    script = ScriptDirectory.from_config(Config(str(settings.alembic_ini)))
    return script.get_current_head()


def _engine(tmp_path):
    return create_engine(f"sqlite:///{tmp_path / 'test.db'}")


def _use(monkeypatch, eng) -> None:
    """把 database 模块的 engine / SessionLocal 都指向测试库。"""
    monkeypatch.setattr(database, "engine", eng)
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=eng))


def _version(eng) -> str | None:
    with eng.connect() as conn:
        return conn.execute(text("select version_num from alembic_version")).scalar()


def test_empty_db_gets_schema_from_baseline(monkeypatch, tmp_path) -> None:
    eng = _engine(tmp_path)
    _use(monkeypatch, eng)

    database.init_db()

    with eng.connect() as conn:
        tables = set(inspect(conn).get_table_names())
    assert tables >= EXPECTED_TABLES
    assert _version(eng) == _expected_head()


def test_legacy_db_is_stamped_and_keeps_data(monkeypatch, tmp_path) -> None:
    """历史库（create_all 建的、没有 alembic_version）应打标而非重建。"""
    eng = _engine(tmp_path)
    Base.metadata.create_all(bind=eng)
    with eng.begin() as conn:
        conn.execute(
            text(
                "insert into workflow (id, name, status, graph_json) "
                "values ('wf_old', '旧工作流', 'draft', '{}')"
            )
        )

    _use(monkeypatch, eng)
    database.init_db()

    assert _version(eng) == _expected_head()
    with eng.connect() as conn:
        name = conn.execute(text("select name from workflow")).scalar()
    assert name == "旧工作流", "打标不能动数据"


def test_init_db_is_idempotent(monkeypatch, tmp_path) -> None:
    eng = _engine(tmp_path)
    _use(monkeypatch, eng)

    database.init_db()
    database.init_db()

    assert _version(eng) == _expected_head()
