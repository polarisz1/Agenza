#!/usr/bin/env node
/**
 * 一键启动：后端 FastAPI + 前端 Vite（跨平台，`pnpm dev` 的实现在这里）。
 *
 * 为什么需要它：`apps/api` 是 Python 项目、不在 pnpm workspace 里，所以
 * `turbo run dev` 只能拉起前端。AGENTS §8 要求 `pnpm dev` 同时起两个进程。
 *
 * 用法：
 *   pnpm dev                       # 默认 8000 / 5174
 *   node tools/scripts/dev.mjs --api-port 8010 --web-port 5180
 *   bash tools/scripts/dev.sh 8010 5180     # 兼容旧的 bash 入口（转调本脚本）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWin = process.platform === 'win32';
const isTTY = process.stdout.isTTY;

// 后端解释器：优先用 apps/api/.venv 里的 Python，避免每次启动都依赖 uv 的缓存目录。
// uv 在部分机器上会因为 UV_CACHE_DIR 指向不可写的位置（如只读盘 / 权限异常的目录）
// 直接报 "Failed to initialize cache" 退出，把整个 pnpm dev 带崩。
// 只有没有 venv 时才回退到 `uv run`（首次 clone 后由用户自行 uv sync）。
const API_VENV_PYTHON = resolve(
  ROOT,
  'apps/api/.venv',
  isWin ? 'Scripts/python.exe' : 'bin/python',
);
const HAS_API_VENV = existsSync(API_VENV_PYTHON);

const RED = isTTY ? '\u001b[31m' : '';
const YELLOW = isTTY ? '\u001b[33m' : '';
const DIM = isTTY ? '\u001b[2m' : '';
const RESET = isTTY ? '\u001b[0m' : '';

function parsePort(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    console.error(`${RED}${flag} 需要一个 1-65535 的端口号，收到：${raw ?? '<空>'}${RESET}`);
    process.exit(1);
  }
  return value;
}

const API_PORT = parsePort('--api-port', 8000);
const WEB_PORT = parsePort('--web-port', 5174);

// 直接调 vite 的入口文件，而不是 `pnpm exec vite`：后者在启动失败时会额外抛一句
// 误导性的 "Command vite not found"，把真正的报错（端口占用）埋掉。
const VITE_BIN = resolve(ROOT, 'apps/web/node_modules/vite/bin/vite.js');

const services = [
  {
    name: 'api',
    label: '后端',
    // 只监听 src/app 的变化，避免被临时文件/数据库写入触发重启
    command: HAS_API_VENV
      ? `"${API_VENV_PYTHON}" -m uvicorn app.main:app ` +
        `--host 127.0.0.1 --port ${API_PORT} --reload --reload-dir src/app`
      : `uv run --directory apps/api python -m uvicorn app.main:app ` +
        `--host 127.0.0.1 --port ${API_PORT} --reload --reload-dir src/app`,
    url: `http://127.0.0.1:${API_PORT}`,
    // venv 直跑要求 cwd 在 apps/api（`app` 包由可编辑安装指向 src）
    cwd: HAS_API_VENV ? resolve(ROOT, 'apps/api') : ROOT,
    // Windows 下 Python 的 stdout 默认按 cp936 编码；pnpm 的日志管道按 UTF-8 解读，
    // 不强制的话中文日志（迁移信息、节点错误）会变成乱码
    env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  },
  {
    name: 'web',
    label: '前端',
    // 端口被占用时允许 Vite 自动递增（不传 --strictPort）：
    // 前端请求走同源 /api 代理，端口变化不影响功能，实际地址以 Vite 输出为准。
    command: `"${process.execPath}" "${VITE_BIN}" --port ${WEB_PORT} --host`,
    url: `http://localhost:${WEB_PORT}`,
    cwd: resolve(ROOT, 'apps/web'),
    // 只改 Vite 的代理目标，不能改 VITE_API_BASE_URL：
    // 后者一旦变成绝对 URL，前端会绕过 Vite 代理直连后端，触发跨域预检；
    // 而后端 CORS 白名单不包含 Vite 端口，请求会被浏览器拦成 "Failed to fetch"。
    env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
  },
];

let shuttingDown = false;
const children = [];

/** 结束进程树：Windows 用 taskkill /T（uv 会再拉起 python 子进程）。 */
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (isWin) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    // detached 后自成进程组，整组一起收
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* 已退出 */
    }
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  process.exitCode = code;
}

function start(service) {
  const child = spawn(service.command, {
    cwd: service.cwd ?? ROOT,
    // 命令里带引号路径，交给 shell 解析最省事
    shell: true,
    stdio: 'inherit',
    detached: !isWin,
    env: { ...process.env, FORCE_COLOR: '1', ...(service.env ?? {}) },
  });
  children.push(child);

  child.on('error', (err) => {
    console.error(`${RED}[${service.name}] 启动失败：${err.message}${RESET}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 || signal) {
      console.log(`${DIM}[${service.name}] 已退出${RESET}`);
      shutdown(0);
      return;
    }
    console.error(`${RED}[${service.name}] 异常退出（code ${code}），正在停止其余进程${RESET}`);
    shutdown(code ?? 1);
  });

  return child;
}

console.log(`${DIM}AgentFlow 开发环境：正在启动后端与前端…${RESET}`);
for (const service of services) {
  // 前端端口被占用时 Vite 会自动递增，这里只标注默认值
  const suffix = service.name === 'web' ? '（被占用时自动换端口，以 Vite 输出为准）' : '';
  console.log(`  ${service.label}：${service.url}${suffix}`);
}
console.log(
  `${YELLOW}提示：${RESET}后端首次启动要跑数据库迁移；后端端口若被占用会启动失败，可用 ` +
  `${DIM}--api-port / --web-port${RESET} 换端口。\n`,
);

for (const service of services) start(service);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
