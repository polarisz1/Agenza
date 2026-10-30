"""数据目录位置与历史迁移（S13 / D-3）。

此前 `ROOT_DIR = parents[4]` 少算一层，数据实际落在 `apps/data`，与注释不符；
打包后还会跟着临时目录跑。现在：
- ROOT_DIR 指向仓库根（用 AGENTS.md 存在性证明）
- DATA_DIR 由环境变量显式覆盖（开发者/Electron 各自指定），默认仓库根下 `data/`
- 旧位置的库与主密钥会被一次性搬过来，且绝不覆盖新位置已有数据
"""

from __future__ import annotations

from pathlib import Path

from app.core.config import DATA_DIR, ROOT_DIR, relocate_legacy_data_dir, settings


def test_root_dir_is_repo_root() -> None:
    assert (ROOT_DIR / "AGENTS.md").exists(), f"ROOT_DIR 应指向仓库根，实际 {ROOT_DIR}"
    assert (ROOT_DIR / "apps" / "api").is_dir()


def test_default_data_dir_is_not_under_apps() -> None:
    assert DATA_DIR == ROOT_DIR / "data"
    assert "apps" not in DATA_DIR.parts, "数据目录不应再落在 apps/ 下"


def test_env_override_is_respected(monkeypatch, tmp_path) -> None:
    """DATA_DIR 环境变量优先（Electron / 开发者可各自指定）。"""
    from app.core.config import Settings

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    fresh = Settings()

    assert Path(fresh.DATA_DIR) == tmp_path
    assert Path(fresh.secret_file).parent == tmp_path


def test_settings_data_dir_is_absolute() -> None:
    assert Path(settings.DATA_DIR).is_absolute()


def test_relocate_moves_files_once(tmp_path) -> None:
    legacy = tmp_path / "apps" / "data"
    target = tmp_path / "data"
    legacy.mkdir(parents=True)
    (legacy / "agentflow.db").write_text("db")
    (legacy / ".secret.key").write_text("key")

    assert relocate_legacy_data_dir(legacy, target) is True

    assert (target / "agentflow.db").read_text() == "db"
    assert (target / ".secret.key").exists()
    assert not legacy.exists()


def test_relocate_never_overwrites_existing_target(tmp_path) -> None:
    legacy = tmp_path / "apps" / "data"
    target = tmp_path / "data"
    legacy.mkdir(parents=True)
    target.mkdir(parents=True)
    (legacy / "agentflow.db").write_text("old")
    (target / "agentflow.db").write_text("new")

    assert relocate_legacy_data_dir(legacy, target) is False
    assert (target / "agentflow.db").read_text() == "new"
    assert legacy.exists(), "目标已存在时不应动旧目录"


def test_relocate_is_noop_without_legacy(tmp_path) -> None:
    assert relocate_legacy_data_dir(tmp_path / "nope", tmp_path / "data") is False


def test_init_db_does_not_touch_legacy_dir_for_custom_data_dir(monkeypatch) -> None:
    """测试/打包会指定 DATA_DIR，此时绝不能搬仓库里的 apps/data。"""
    from app.core import config as config_module
    from app.db import database

    called: list[Path] = []
    monkeypatch.setattr(
        config_module,
        "relocate_legacy_data_dir",
        lambda legacy, target: called.append(legacy) or False,
    )

    assert Path(settings.DATA_DIR) != config_module.DATA_DIR, "本用例需要非默认 DATA_DIR"
    database._relocate_legacy_data()

    assert called == [], "DATA_DIR 非默认值时不应触发迁移"
