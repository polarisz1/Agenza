#!/usr/bin/env node
/**
 * 契约兼容性检查（评审 B4）。
 *
 *   pnpm contracts:compat            # 对比"已提交契约"与"基线"，有破坏性变更就退出 1
 *   pnpm contracts:baseline          # 把当前契约快照为新的基线（发版时执行）
 *
 * 基线文件：packages/contracts/baseline/openapi.yaml
 *
 * 为什么需要它：`contracts:check` 只保证"仓库里的 yaml/ts 与后端当前输出一致"，
 * 属于**同版本自洽**；它无法阻止一次"删字段/改类型/加必填参数"的提交悄悄合入。
 * 兼容性检查从调用方视角守住这条线。
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { findBreakingChanges } from './compat-rules.mjs';
import { REPO_ROOT, readYamlAsJson, resolvePython } from './lib.mjs';

const CONTRACTS = join(REPO_ROOT, 'packages', 'contracts');
const DEFAULT_CURRENT = join(CONTRACTS, 'openapi.yaml');
const DEFAULT_BASELINE = join(CONTRACTS, 'baseline', 'openapi.yaml');

const args = parseArgs(process.argv.slice(2));

if (args.writeBaseline) {
  writeBaseline();
} else {
  compare();
}

function writeBaseline() {
  const current = args.current;
  if (!existsSync(current)) fail(`找不到当前契约：${current}（先跑 pnpm contracts:generate）`);
  mkdirSync(dirname(args.baseline), { recursive: true });
  copyFileSync(current, args.baseline);
  console.log(`[contracts:compat] 已把 ${fmt(current)} 写入基线 ${fmt(args.baseline)}`);
}

function compare() {
  if (!existsSync(args.baseline)) {
    fail(
      `缺少兼容性基线：${fmt(args.baseline)}\n` +
        '  首次建立：pnpm contracts:baseline（发版时也用它刷新基线）',
    );
  }
  if (!existsSync(args.current)) fail(`找不到当前契约：${args.current}`);

  const python = resolvePython();
  if (!python) fail('找不到 Python：请先创建 apps/api/.venv，或安装 uv');

  const baseline = readYamlAsJson(python, args.baseline);
  const current = readYamlAsJson(python, args.current);
  const { breaking, warnings } = findBreakingChanges(baseline, current);

  for (const item of warnings) {
    console.log(`  ! ${item.path}\n    ${item.message}`);
  }
  for (const item of breaking) {
    console.error(`  ✗ ${item.path}\n    ${item.message}`);
  }

  if (breaking.length) {
    console.error(
      `[contracts:compat] FAIL - ${breaking.length} 处破坏性变更（基线 ${fmt(args.baseline)}）`,
    );
    console.error(
      '[contracts:compat] 若这是有意为之：同步升级调用方，并在发版时执行 pnpm contracts:baseline',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[contracts:compat] OK - 无破坏性变更（${breaking.length} breaking / ${warnings.length} warning）`,
  );
}

function parseArgs(argv) {
  const options = {
    current: DEFAULT_CURRENT,
    baseline: DEFAULT_BASELINE,
    writeBaseline: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write-baseline') options.writeBaseline = true;
    else if (arg === '--current' && argv[i + 1]) options.current = resolve(argv[++i]);
    else if (arg === '--baseline' && argv[i + 1]) options.baseline = resolve(argv[++i]);
    else fail(`未知参数：${arg}`);
  }
  return options;
}

function fmt(path) {
  return relative(REPO_ROOT, path) || path;
}

function fail(message) {
  console.error(`[contracts:compat] ${message}`);
  process.exit(1);
}
