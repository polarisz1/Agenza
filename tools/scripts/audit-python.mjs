#!/usr/bin/env node
/**
 * Python 依赖漏洞审计（评审 B2：`pip-audit` 从未跑过）。
 *
 * 做法：`uv export` 出锁定依赖（不含 dev）→ `uvx pip-audit -r`。
 * 不往仓库里塞 requirements 文件，每次审计用临时文件，产物永远与 uv.lock 一致。
 *
 * 用法：pnpm audit:py
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_DIR = join(ROOT, 'apps', 'api');
const tmp = mkdtempSync(join(tmpdir(), 'agentflow-audit-'));
const requirements = join(tmp, 'requirements.txt');

function run(command, args, label) {
  console.log(`[audit:py] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    // pip-audit 的 requirements 解析器用 locale 编码读文件；Windows 下是 cp936，
    // 遇到 uv export 里的非 ASCII 注释会直接 UnicodeDecodeError。强制 UTF-8。
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (result.error) {
    console.error(`[audit:py] 无法执行 ${command}：${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

let status = 1;
try {
  status = run(
    'uv',
    ['export', '--directory', API_DIR, '--frozen', '--no-dev', '--no-emit-project', '-o', requirements],
    '导出锁定依赖...',
  );
  if (status === 0) {
    status = run('uvx', ['pip-audit', '-r', requirements, '--progress-spinner', 'off'], 'pip-audit ...');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (status === 0) console.log('[audit:py] OK - 未发现已知漏洞');
process.exit(status);
