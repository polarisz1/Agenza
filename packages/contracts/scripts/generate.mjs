#!/usr/bin/env node
/**
 * 导出后端 OpenAPI 契约（跨平台，不依赖 bash / git）。
 *
 * 用法：
 *   node packages/contracts/scripts/generate.mjs [--out <path>]
 *
 * 流程：启动 apps/api → 拉取 /openapi.json → 转成 openapi.yaml。
 * 端口可用环境变量 AGENTFLOW_API_PORT 覆盖（默认 8765）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { API_DIR, REPO_ROOT, resolvePython } from './lib.mjs';

const ROOT = REPO_ROOT;
const API_SRC = join(API_DIR, 'src');
const DEFAULT_OUT = join(ROOT, 'packages', 'contracts', 'openapi.yaml');
const PORT = Number(process.env.AGENTFLOW_API_PORT || 8765);

const outPath = parseArgs(process.argv.slice(2));
const python = resolvePython();

if (!python) {
  console.error('[contracts:generate] 找不到 Python：请先创建 apps/api/.venv，或安装 uv');
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });

console.log(`[contracts:generate] 启动 apps/api（127.0.0.1:${PORT}）...`);
const server = spawn(
  python.cmd,
  [
    ...python.prefix,
    '-m', 'uvicorn', 'app.main:app',
    '--app-dir', API_SRC,
    '--host', '127.0.0.1',
    '--port', String(PORT),
  ],
  { cwd: ROOT, stdio: 'ignore', windowsHide: true },
);

let serverExited = false;
server.on('exit', () => {
  serverExited = true;
});

const stopServer = () => {
  if (serverExited || !server.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
  serverExited = true;
};

process.on('exit', stopServer);
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});

try {
  const spec = await fetchSpec(`http://127.0.0.1:${PORT}/openapi.json`);
  console.log('[contracts:generate] 转换为 YAML...');
  writeYaml(spec, outPath);
  console.log(`[contracts:generate] 已写入 ${outPath}`);
} catch (err) {
  console.error(`[contracts:generate] 失败：${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  stopServer();
}

// Node 的 fetch 连接池会保留 keep-alive 套接字，显式退出避免脚本悬挂
process.exit(process.exitCode ?? 0);

function parseArgs(argv) {
  const idx = argv.indexOf('--out');
  if (idx >= 0 && argv[idx + 1]) return resolve(argv[idx + 1]);
  return DEFAULT_OUT;
}

async function fetchSpec(url) {
  const attempts = 80;
  // 总预算 + 单次请求双重超时（评审 G30）：后端卡死时脚本必须自己失败退出，
  // 而不是让 CI 空等。每次 fetch 5s，整体最多 45s。
  const deadline = Date.now() + 45_000;
  for (let i = 0; i < attempts; i += 1) {
    if (serverExited) throw new Error('后端启动失败（端口可能被占用，可设置 AGENTFLOW_API_PORT 换端口）');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) return await res.json();
    } catch {
      // 尚未就绪 / 单次超时：继续重试
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等待 ${url} 超时（45s）：后端未就绪或 /openapi.json 无响应`);
}

function writeYaml(spec, path) {
  // 中文不能走 stdin：Windows 下 Python 的 stdin 默认是 cp936，UTF-8 字节会被
  // 按 GBK 解码成乱码（还会写进 lone surrogate）。改成"临时文件 + 显式 utf-8"，
  // 并强制 PYTHONUTF8，保证任何平台的 CI 产物都一致。
  const tmpJson = join(tmpdir(), `agentflow-openapi-${process.pid}-${Date.now()}.json`);
  writeFileSync(tmpJson, JSON.stringify(spec), 'utf-8');

  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], encoding="utf-8") as f:',
    '    spec = json.load(f)',
    'with open(sys.argv[2], "w", encoding="utf-8", newline="\\n") as f:',
    '    yaml.dump(spec, f, sort_keys=False, allow_unicode=True, default_flow_style=False)',
  ].join('\n');

  try {
    const result = spawnSync(python.cmd, [...python.prefix, '-c', script, tmpJson, path], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    if (result.status !== 0) {
      throw new Error(`YAML 转换失败（需要 PyYAML）：${result.stderr || result.error}`);
    }
  } finally {
    rmSync(tmpJson, { force: true });
  }
}
