"""D-5：Python 节点的解释器来源。

打包后 `sys.executable` 就是 `backend.exe`，拿它当解释器等于再起一个后端
（M4 前置验证 ① 已实测复现：spawn 出来的是后端自己的 banner）。
这里验证优先级与兜底错误信息。
"""

from __future__ import annotations

import sys
from pathlib import Path

from app.core.engine.executors.python import resolve_python_bin


def test_explicit_bin_wins(tmp_path: Path) -> None:
    fake = tmp_path / "python.exe"
    fake.write_text("", encoding="utf-8")

    path, error = resolve_python_bin(explicit=str(fake), resource_dir=tmp_path, frozen=True)

    assert error is None
    assert path == str(fake)


def test_explicit_bin_missing_reports_clearly(tmp_path: Path) -> None:
    path, error = resolve_python_bin(explicit=str(tmp_path / "nope.exe"), frozen=True)

    assert path is None
    assert "PYTHON_BIN" in (error or "")
    assert "不存在" in (error or "")


def test_bundled_interpreter_is_preferred(tmp_path: Path) -> None:
    emb = tmp_path / "pyemb"
    emb.mkdir()
    exe = emb / "python.exe"
    exe.write_text("", encoding="utf-8")

    path, error = resolve_python_bin(resource_dir=tmp_path, frozen=True)

    assert error is None
    assert path == str(exe)


def test_frozen_without_bundled_interpreter_fails_with_hint(tmp_path: Path) -> None:
    """打包态找不到内置解释器时，必须报错而不是退回 sys.executable。"""
    path, error = resolve_python_bin(resource_dir=tmp_path, frozen=True)

    assert path is None
    assert "pyemb" in (error or "")
    assert str(tmp_path) in (error or "")


def test_frozen_without_resource_dir_fails() -> None:
    path, error = resolve_python_bin(frozen=True)

    assert path is None
    assert "--resource-dir" in (error or "")


def test_dev_falls_back_to_current_interpreter() -> None:
    """开发态没有资源目录，沿用当前解释器（venv 里的 python）。"""
    path, error = resolve_python_bin(frozen=False)

    assert error is None
    assert path == sys.executable


def test_dev_prefers_bundled_interpreter_when_present(tmp_path: Path) -> None:
    """开发态若显式给了资源目录且里面有内置解释器，也优先用它（便于本地验证打包效果）。"""
    emb = tmp_path / "pyemb"
    emb.mkdir()
    exe = emb / "python.exe"
    exe.write_text("", encoding="utf-8")

    path, _ = resolve_python_bin(resource_dir=tmp_path, frozen=False)

    assert path == str(exe)
