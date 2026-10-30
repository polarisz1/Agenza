#!/usr/bin/env bash
# 兼容入口：真正的实现是 tools/scripts/dev.mjs（跨平台，与 `pnpm dev` 同一份逻辑）。
# 保留这个文件是因为设计文档引用了 tools/scripts/dev.sh，且习惯 bash 的同学会直接敲它。
#
# Usage: bash tools/scripts/dev.sh [api-port] [web-port]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 这个 bash 可能是 WSL / Git Bash，里面不一定有 node。
# 与其抛一句 "exec: node: not found"，不如直接告诉用户该怎么跑。
if ! command -v node >/dev/null 2>&1; then
  cat >&2 <<'EOF'
[dev] 当前 bash 环境里找不到 node（常见于 WSL：system32\bash.exe 是 WSL，不是 Git Bash）。

请改用以下任一方式：
  1) 在 Windows 终端（PowerShell/CMD）里直接运行：  pnpm dev
  2) 自定义端口：  node tools/scripts/dev.mjs --api-port 8000 --web-port 5173
  3) 或在这个 bash 里先安装 Node.js（>= 20）再重试
EOF
  exit 127
fi

args=()
if [ "${1:-}" != "" ]; then args+=("--api-port" "$1"); fi
if [ "${2:-}" != "" ]; then args+=("--web-port" "$2"); fi

exec node "$ROOT/tools/scripts/dev.mjs" "${args[@]}"
