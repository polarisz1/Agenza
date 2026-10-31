# -*- mode: python ; coding: utf-8 -*-
"""AgentFlow 后端打包配置（单文件 exe，AGENTS §5）。

用法：`uv run --project apps/api --with pyinstaller python pyinstaller/build.py`
（不要直接调 pyinstaller —— build.py 会先检查前置产物，并清理旧产物）

资源布局：全部塞进 exe，运行时由 PyInstaller 解压到 `sys._MEIPASS`：
    _MEIPASS/alembic/        迁移脚本
    _MEIPASS/alembic.ini
    _MEIPASS/frontend-dist/  前端产物
    _MEIPASS/pyemb/          随包 embeddable CPython（跑"Python 脚本"节点）
`core/config.py::resource_root` 在冻结态会自动把 `_MEIPASS` 当资源根目录。
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).resolve().parents[0]  # noqa: F821 - SPECPATH = 本文件所在目录（pyinstaller/）
API = ROOT / "apps" / "api"
WEB_DIST = ROOT / "apps" / "web" / "dist"
PYEMB = ROOT / "pyinstaller" / "pyemb"


def _datas() -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = [
        (str(API / "alembic"), "alembic"),
        (str(API / "alembic.ini"), "."),
        (str(WEB_DIST), "frontend-dist"),
    ]
    if PYEMB.is_dir():
        items.append((str(PYEMB), "pyemb"))
    return items


a = Analysis(  # noqa: F821
    [str(API / "src" / "app" / "run.py")],
    pathex=[str(API / "src")],
    binaries=[],
    datas=_datas(),
    hiddenimports=[
        "alembic",
        "alembic.runtime.migration",
        "loguru",
        # uvicorn 的协议实现是动态导入的，打包时容易漏
        "uvicorn.logging",
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
        # 业务模块里有 import_module("app.modules.<x>.models") 这类动态导入，
        # 静态分析看不到，整包收入
        *collect_submodules("app"),
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
