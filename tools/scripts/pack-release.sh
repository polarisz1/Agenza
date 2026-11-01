#!/usr/bin/env bash
# 打包桌面发布产物。
#   1) 前端 build
#   2) 后端 PyInstaller（单文件 exe，含 alembic / frontend-dist / 随包解释器）
#   3) Electron 壳打包（electron-builder）
#
# 前置：pyinstaller/pyemb/ 里要有 embeddable CPython（见 docs/m4-spike-notes.md ①）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "[pack] Step 1: Frontend build"
pnpm --filter @agentflow/web build

echo "[pack] Step 2: Backend PyInstaller build"
uv run --project apps/api --with pyinstaller python pyinstaller/build.py

echo "[pack] Step 3: Electron build"
# 与 .github/workflows 保持一致：用锁文件安装，避免本机 node_modules 里的旧包混进产物
(cd electron && npm ci && npx electron-builder --win nsis --x64)

echo "[pack] Done. Artifact at: electron/dist_electron/"
ls -lah electron/dist_electron/ 2>/dev/null || true
