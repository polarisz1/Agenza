"""打包后端为单文件 exe。

用法（仓库根目录）：
    uv run --project apps/api --with pyinstaller python pyinstaller/build.py

前置：
- 前端产物：`pnpm build:web`
- 随包解释器：把 `python-3.12.x-embed-amd64.zip` 解压到 `pyinstaller/pyemb/`
  （里面要有 `python.exe`；该目录不入库，见 .gitignore）

产物：`apps/api/dist_backend/backend.exe`
（electron-builder 的 `extraResources` 会把它拷到安装包的 `resources/backend/`）
"""

from __future__ import annotations

import contextlib
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps" / "api"
SPEC = ROOT / "pyinstaller" / "backend.spec"
BUILD_DIST = ROOT / ".build" / "dist"
FINAL_DIR = API / "dist_backend"  # 与 electron-builder.yml 的 extraResources 对齐
WORK = ROOT / ".build" / "pyinstaller"
PYEMB = ROOT / "pyinstaller" / "pyemb"


def fail(message: str) -> None:
    print(f"[pack] ✗ {message}", file=sys.stderr)
    raise SystemExit(1)


def check() -> None:
    index = ROOT / "apps" / "web" / "dist" / "index.html"
    if not index.is_file():
        fail("缺少前端产物：先跑 `pnpm build:web`（期望 apps/web/dist/index.html）")

    if not (API / "alembic.ini").is_file() or not (API / "alembic").is_dir():
        fail("缺少 alembic 配置：apps/api/alembic.ini 与 apps/api/alembic/")

    if not (PYEMB / "python.exe").is_file():
        fail(
            "缺少随包解释器：把 python-3.12.x-embed-amd64.zip 解压到 pyinstaller/pyemb/，"
            "确保 pyinstaller/pyemb/python.exe 存在"
        )


def build() -> Path:
    for path in (BUILD_DIST, WORK):
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath",
        str(BUILD_DIST),
        "--workpath",
        str(WORK),
        str(SPEC),
    ]
    print("[pack] " + " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)

    built = BUILD_DIST / "backend.exe"
    if not built.is_file():
        fail(f"打包结束但没找到产物：{built}")

    # 先打到 .build/ 再复制：PyInstaller 会"先删后写"目标文件，
    # 某些环境下对既有 exe 的删除会被拒（本机实测），复制则没问题
    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    final = FINAL_DIR / "backend.exe"
    _install(built, final)

    size_mb = final.stat().st_size / (1024 * 1024)
    print(f"[pack] ✓ 产物：{final}（{size_mb:.1f} MB）")
    return final


def _install(built: Path, final: Path, attempts: int = 20) -> None:
    """把产物装到目标位置。

    坑：某些环境（含杀软实时扫描）里，Python 覆盖"已存在的同名 exe"会 `WinError 5`，
    但**新建**没问题。所以每次都先删再复制；删不掉就等一下重试。
    还不行则退回 shell 的 copy（Windows 实测可行）。
    """
    last_error: Exception | None = None
    for _ in range(attempts):
        try:
            if final.exists():
                final.unlink()
            shutil.copyfile(built, final)
            return
        except PermissionError as exc:  # 目标被占用
            last_error = exc
            time.sleep(1.0)

    if os.name == "nt":
        copied = subprocess.run(
            ["cmd", "/c", "copy", "/y", str(built), str(final)],
            capture_output=True,
            text=True,
        )
        if copied.returncode == 0:
            return
        last_error = last_error or RuntimeError(copied.stderr.strip())

    fail(
        f"无法写入 {final}：{last_error}\n"
        f"       多半是旧进程还在运行或安全软件正在扫描。请结束后重试；"
        f"产物已生成在 {built}"
    )


def main() -> None:
    check()
    build()
    print(
        "[pack] 冒烟建议：\n"
        "  backend.exe --port 8031 --data-dir <临时目录> --log-level warning\n"
        "  curl http://127.0.0.1:8031/health   （或 Invoke-WebRequest）"
    )


if __name__ == "__main__":
    main()
