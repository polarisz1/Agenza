#!/usr/bin/env bash
# Build a desktop release artifact.
# Prerequisites: pnpm, uv, pyinstaller, electron-builder
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "[pack] Step 1: Frontend build"
pnpm --filter @agentflow/web build

echo "[pack] Step 2: Backend PyInstaller build"
(cd apps/api && \
  uv run pyinstaller --onefile \
    --name backend.exe \
    src/app/run.py \
    --distpath ../../electron/resources \
    --workpath ../../.build/pyinstaller \
    --noconfirm \
    --hidden-import alembic \
    --hidden-import loguru)

echo "[pack] Step 3: Electron build"
(cd electron && npm install && npm run build)

echo "[pack] Done. Artifact at: electron/dist_electron/"
ls -lah electron/dist_electron/
