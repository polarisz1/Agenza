#!/usr/bin/env node
/**
 * 一键启动：后端 FastAPI + 前端 Vite。
 *
 * 为什么需要这个脚本：`apps/api` 是 Python 项目，不在 pnpm workspace 里，
 * 所以 `turbo run dev` 只能拉起前端。AGENTS §8 要求 `pnpm dev` 同时起两个进程，
 * 这里用一个零依赖的 Node 脚本做编排（并为 Ctrl+C 做进程树清理）。
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

const services = [
  {
    name: 'api',
    label: '后端',
    command: 'uv run --directory apps/api python -m app.run',
    url: 'http://127.0.0.1:8000',
  },
  {
    name: 'web',
    label: '前端',
    command: 'pnpm --filter @agentflow/web dev',
    url: 'http://localhost:5173',
  },
];

let shuttingDown = false;
const children = [];

/** 结束进程树：Windows 用 taskkill /T（venv/uv 会再拉起 python 子进程）。 */
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
    cwd: ROOT,
    // Windows 上 pnpm 是 .cmd，必须走 shell 才能解析
    shell: true,
    stdio: 'inherit',
    detached: !isWin,
    env: { ...process.env, FORCE_COLOR: '1' },
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
  console.log(`  ${service.label}：${service.url}  ${DIM}(${service.command})${RESET}`);
}
console.log(
  `${YELLOW}提示：${RESET}后端首次启动要跑数据库迁移；若 5173 被占用，Vite 会自动换端口，以它打印的地址为准。\n`,
);

for (const service of services) start(service);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
