#!/usr/bin/env node
/**
 * 契约漂移检测（跨平台，不依赖 git）。
 *
 * 校验两件事：
 *   1. 重新导出的 openapi.yaml 与已提交文件完全一致
 *   2. 重新生成的 src/generated/index.ts 与已提交文件完全一致
 *
 * 用法：node packages/contracts/scripts/check.mjs
 * 漂移时以非 0 退出码结束。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '../../..');
const CONTRACTS = join(ROOT, 'packages', 'contracts');
const COMMITTED_YAML = join(CONTRACTS, 'openapi.yaml');
const COMMITTED_TS = join(CONTRACTS, 'src', 'generated', 'index.ts');
const CLI = join(ROOT, 'node_modules', 'openapi-typescript', 'bin', 'cli.js');

const tmp = mkdtempSync(join(tmpdir(), 'agentflow-contracts-'));

try {
  const freshYaml = join(tmp, 'openapi.yaml');
  console.log('[contracts:check] 重新导出 OpenAPI...');
  execFileSync(process.execPath, [join(SCRIPT_DIR, 'generate.mjs'), '--out', freshYaml], {
    stdio: 'inherit',
  });
  compare('openapi.yaml', COMMITTED_YAML, freshYaml);

  const freshTs = join(tmp, 'index.ts');
  console.log('[contracts:check] 重新生成 TS 类型...');
  execFileSync(process.execPath, [CLI, freshYaml, '-o', freshTs], { stdio: 'inherit' });
  compare('src/generated/index.ts', COMMITTED_TS, freshTs);

  console.log('[contracts:check] OK - 契约与生成类型都与后端一致');
} catch (err) {
  console.error(`[contracts:check] FAIL - ${err instanceof Error ? err.message : err}`);
  console.error('[contracts:check] 修复：pnpm contracts:generate && pnpm contracts:build');
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function compare(label, committedPath, freshPath) {
  // 换行统一后再比较：Windows 工作区（core.autocrlf=true）会把 LF 变成 CRLF，
  // 逐字节比较会因此假报漂移。真正的漂移是内容差异，不是行尾风格。
  const normalize = (text) => text.replace(/\r\n/g, '\n');
  const committed = normalize(readFileSync(committedPath, 'utf8'));
  const fresh = normalize(readFileSync(freshPath, 'utf8'));
  if (committed === fresh) return;

  const a = committed.split('\n');
  const b = fresh.split('\n');
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) {
      throw new Error(
        `${label} 已漂移（第 ${i + 1} 行）\n  已提交: ${a[i] ?? '<无>'}\n  当前后端: ${b[i] ?? '<无>'}`,
      );
    }
  }
  throw new Error(`${label} 已漂移`);
}
