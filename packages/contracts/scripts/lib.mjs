/**
 * 契约脚本共用工具：定位 Python 解释器 / 把 YAML 读成 JSON。
 *
 * generate.mjs 与 compat.mjs 都需要"用 Python 解析 YAML"（Python 侧已有 PyYAML，
 * 避免为脚本再引入一个 JS YAML 依赖），所以把这段收成一份。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..', '..', '..');
export const API_DIR = join(REPO_ROOT, 'apps', 'api');

/**
 * 后端依赖都在 apps/api（uv 管理）。返回 { cmd, prefix } 或 null。
 * prefix 用于 `uv run` 这种"命令 + 前置参数"的组合。
 */
export function resolvePython() {
  const candidates = [
    join(API_DIR, '.venv', 'Scripts', 'python.exe'),
    join(API_DIR, '.venv', 'bin', 'python'),
  ];
  const venv = candidates.find((p) => existsSync(p));
  if (venv) return { cmd: venv, prefix: [] };

  const uv = spawnSync('uv', ['--version'], { encoding: 'utf-8' });
  if (uv.status === 0) return { cmd: 'uv', prefix: ['run', '--project', API_DIR, 'python'] };
  return null;
}

/** 用后端解释器把 YAML 读成 JSON（PyYAML 已在后端依赖里）。 */
export function readYamlAsJson(python, yamlPath) {
  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], encoding="utf-8") as f:',
    '    json.dump(yaml.safe_load(f), sys.stdout)',
  ].join('\n');

  const result = spawnSync(python.cmd, [...python.prefix, '-c', script, yamlPath], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  if (result.status !== 0) {
    throw new Error(`解析 YAML 失败：${yamlPath}\n${result.stderr || result.error || ''}`);
  }
  return JSON.parse(result.stdout);
}
