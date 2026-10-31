"""启动参数注入（评审 ②）：端口 / 数据目录 / 资源目录 / 是否托管前端。

这三项必须在 import app.main 之前就位——`Settings` 是导入时创建的单例，
所以真正的入口是 `app.run.main()`，不是直接 `uvicorn app.main:app`。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.config import Settings
from app.run import LaunchPlan, resolve_launch


def test_defaults_when_nothing_is_given() -> None:
    plan = resolve_launch({}, [])

    assert plan == LaunchPlan(
        host="127.0.0.1",
        port=8000,
        data_dir=None,
        resource_dir=None,
        mount_frontend=False,
        reload=True,
        log_level="INFO",
    )


def test_cli_overrides_env() -> None:
    env = {"HOST": "0.0.0.0", "PORT": "9000", "DATA_DIR": "/env/data", "LOG_LEVEL": "WARNING"}
    plan = resolve_launch(
        env,
        [
            "--host",
            "127.0.0.1",
            "--port",
            "9100",
            "--data-dir",
            "/cli/data",
            "--resource-dir",
            "/cli/res",
            "--log-level",
            "debug",
        ],
    )

    assert (plan.host, plan.port) == ("127.0.0.1", 9100)
    assert (plan.data_dir, plan.resource_dir) == ("/cli/data", "/cli/res")
    assert plan.log_level == "DEBUG"


def test_env_is_used_when_cli_omits_the_flag() -> None:
    plan = resolve_launch({"PORT": "9200", "DATA_DIR": "/env/data"}, [])

    assert plan.port == 9200
    assert plan.data_dir == "/env/data"


def test_frozen_forces_reload_off() -> None:
    """打包后不能开 reload：uvicorn 的 reloader 会再拉一个进程。"""
    plan = resolve_launch({"DEBUG": "true"}, [], frozen=True)

    assert plan.reload is False


def test_frozen_mounts_frontend_by_default() -> None:
    """打包态默认由后端托管前端，否则窗口打开是 JSON 404。"""
    assert resolve_launch({}, [], frozen=True).mount_frontend is True
    assert resolve_launch({}, [], frozen=False).mount_frontend is False


def test_mount_frontend_can_be_disabled_explicitly() -> None:
    plan = resolve_launch({}, ["--no-mount-frontend"], frozen=True)

    assert plan.mount_frontend is False


def test_as_env_only_sets_present_paths() -> None:
    plan = resolve_launch({}, [])
    env = plan.as_env()

    assert env["PORT"] == "8000"
    assert env["MOUNT_FRONTEND"] == "false"
    assert "DATA_DIR" not in env
    assert "RESOURCE_DIR" not in env


# ---------- settings 侧：资源目录优先级 ----------


def _settings(**kwargs) -> Settings:
    return Settings(_env_file=None, **kwargs)


def test_frontend_dist_falls_back_to_repo_layout() -> None:
    s = _settings(RESOURCE_DIR="")

    assert s.frontend_dist.name == "dist"
    assert s.frontend_dist.parent.name == "web"


def test_resource_dir_wins_when_it_has_frontend_dist(tmp_path: Path) -> None:
    (tmp_path / "frontend-dist").mkdir()
    (tmp_path / "frontend-dist" / "index.html").write_text("x", encoding="utf-8")

    s = _settings(RESOURCE_DIR=str(tmp_path))

    assert s.frontend_dist == tmp_path / "frontend-dist"


def test_alembic_paths_prefer_resource_dir(tmp_path: Path) -> None:
    (tmp_path / "alembic" / "versions").mkdir(parents=True)
    (tmp_path / "alembic.ini").write_text("[alembic]\n", encoding="utf-8")

    s = _settings(RESOURCE_DIR=str(tmp_path))

    assert s.alembic_ini == tmp_path / "alembic.ini"
    assert s.alembic_dir == tmp_path / "alembic"


def test_alembic_paths_fall_back_to_repo(tmp_path: Path) -> None:
    """资源目录里没有 alembic 时回退仓库布局，而不是当成"缺失"走 create_all。"""
    s = _settings(RESOURCE_DIR=str(tmp_path))

    assert s.alembic_ini.name == "alembic.ini"
    assert s.alembic_dir.name == "alembic"
    assert s.resource_root == tmp_path


def test_missing_resource_dir_is_treated_as_absent() -> None:
    s = _settings(RESOURCE_DIR=str(Path("does-not-exist-anywhere")))

    assert s.resource_root is None
    assert s.frontend_dist.parent.name == "web"


@pytest.mark.parametrize("raw,expected", [("true", True), ("0", False), ("maybe", False)])
def test_mount_flag_from_env_is_strict_boolean(raw: str, expected: bool) -> None:
    """非真值的字符串不应被当成"开启"（避免 MOUNT_FRONTEND=no 反而打开）。"""
    plan = resolve_launch({"MOUNT_FRONTEND": raw}, [])

    assert plan.mount_frontend is expected
