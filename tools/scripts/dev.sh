#!/usr/bin/env bash
# One-command dev setup - starts FastAPI (uvicorn --reload) + Vite dev server (HMR).
# Usage: bash tools/scripts/dev.sh [api-port] [web-port]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_PORT="${1:-8000}"
WEB_PORT="${2:-5173}"

echo "============================================="
echo " AgentFlow · dev mode"
echo "============================================="
echo " API  : http://127.0.0.1:${API_PORT}"
echo " Web  : http://localhost:${WEB_PORT}"
echo "============================================="

cleanup() {
  echo "[dev] Stopping services..."
  [ -n "${API_PID:-}" ] && kill $API_PID 2>/dev/null || true
  [ -n "${WEB_PID:-}" ] && kill $WEB_PID 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT"

# --- Backend ---
echo "[dev] Starting FastAPI on :${API_PORT} ..."
(cd apps/api && \
  uv run python -m uvicorn app.main:app \
    --host 127.0.0.1 --port $API_PORT \
    --reload --reload-dir src/app) &
API_PID=$!

# --- Frontend ---
echo "[dev] Starting Vite dev server on :${WEB_PORT} ..."
(cd apps/web && VITE_API_BASE_URL="http://127.0.0.1:${API_PORT}" pnpm dev --port $WEB_PORT --host) &
WEB_PID=$!

wait
