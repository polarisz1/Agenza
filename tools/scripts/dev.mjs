#!/usr/bin/env node
/**
 * 一键启动：后端 FastAPI + 前端 Vite（跨平台，`pnpm dev` 的实现在这里）。
 *
 * 为什么需要它：`apps/api` 是 Python 项目、不在 pnpm workspace 里，所以
 * `turbo run dev` 只能拉起前端。AGENTS §8 要求 `pnpm dev` 同时起两个进程。
 *
 * 用法：
 *   pnpm dev                       # 默认 8000 / 5173
 *   node tools/scripts/dev.mjs --api-port 8010 --web-port 5180
 *   bash tools/scripts/dev.sh 8010 5180     # 兼容旧的 bash 入口（转调本脚本）
 */
import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWin = process.platform === 'win32';
const isTTY = process.stdout.isTTY;

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
const WEB_PORT = parsePort('--web-port', 5173);

// 直接调 vite 的入口文件，而不是 `pnpm exec vite`：后者在启动失败时会额外抛一句
// 误导性的 "Command vite not found"，把真正的报错（端口占用）埋掉。
const VITE_BIN = resolve(ROOT, 'apps/web/node_modules/vite/bin/vite.js');

const services = [
  {
    name: 'api',
    label: '后端',
    // 只监听 src/app 的变化，避免被临时文件/数据库写入触发重启
    command:
      `uv run --directory apps/api python -m uvicorn app.main:app ` +
      `--host 127.0.0.1 --port ${API_PORT} --reload --reload-dir src/app`,
    url: `http://127.0.0.1:${API_PORT}`,
    cwd: ROOT,
  },
  {
    name: 'web',
    label: '前端',
    command: `"${process.execPath}" "${VITE_BIN}" --port ${WEB_PORT} --host --strictPort`,
    url: `http://localhost:${WEB_PORT}`,
    cwd: resolve(ROOT, 'apps/web'),
    // 让 Vite 的 /api 代理指向自定义的后端端口
    env: { VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}` },
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
  console.log(`  ${service.label}：${service.url}`);
}
console.log(
  `${YELLOW}提示：${RESET}后端首次启动要跑数据库迁移；端口若被占用会启动失败，可用 ` +
    `${DIM}--api-port / --web-port${RESET} 换端口。前端用了 --strictPort，端口被占用会直接报错而不是悄悄换号。\n`,
);

for (const service of services) start(service);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
