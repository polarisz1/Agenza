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
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '../../..');
const API_DIR = join(ROOT, 'apps', 'api');
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

function resolvePython() {
  const candidates = [
    join(API_DIR, '.venv', 'Scripts', 'python.exe'),
    join(API_DIR, '.venv', 'bin', 'python'),
  ];
  const venv = candidates.find((p) => existsSync(p));
  if (venv) return { cmd: venv, prefix: [] };

  const uv = spawnSync('uv', ['--version'], { encoding: 'utf-8' });
  if (uv.status === 0) {
    return { cmd: 'uv', prefix: ['run', '--project', API_DIR, 'python'] };
  }
  return null;
}

async function fetchSpec(url) {
  const attempts = 80;
  for (let i = 0; i < attempts; i += 1) {
    if (serverExited) throw new Error('后端启动失败（端口可能被占用，可设置 AGENTFLOW_API_PORT 换端口）');
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // 尚未就绪，继续重试
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等待 ${url} 超时`);
}

function writeYaml(spec, path) {
  const script = [
    'import json, sys, yaml',
    'spec = json.load(sys.stdin)',
    'with open(sys.argv[1], "w", encoding="utf-8") as f:',
    '    yaml.dump(spec, f, sort_keys=False, allow_unicode=True, default_flow_style=False)',
  ].join('\n');

  const result = spawnSync(python.cmd, [...python.prefix, '-c', script, path], {
    cwd: ROOT,
    input: JSON.stringify(spec),
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`YAML 转换失败（需要 PyYAML）：${result.stderr || result.error}`);
  }
}
