/** 运行域共享的展示映射（RunDetail / RunCompare / RunList 共用）。 */

export interface StatusMeta {
  label: string;
  /** AntD Tag 颜色 */
  color: string;
  /** 行内符号 */
  symbol: string;
}

const STATUS: Record<string, StatusMeta> = {
  running: { label: '运行中', color: 'processing', symbol: '●' },
  success: { label: '成功', color: 'green', symbol: '✓' },
  failed: { label: '失败', color: 'red', symbol: '✕' },
  cancelled: { label: '已取消', color: 'default', symbol: '⊘' },
  skipped: { label: '已跳过', color: 'orange', symbol: '⊘' },
  waiting_input: { label: '等待输入', color: 'blue', symbol: '⏸' },
};

export function statusMeta(status?: string | null): StatusMeta {
  return STATUS[status || ''] ?? { label: status || '未知', color: 'default', symbol: '·' };
}

export const TRIGGER_LABEL: Record<string, string> = {
  manual: '手动',
  debug: '调试',
  scheduled: '定时',
};

export function triggerLabel(trigger?: string | null): string {
  return TRIGGER_LABEL[trigger || ''] ?? trigger ?? '—';
}

/** JSON 美化；不可序列化时退回 String。 */
export function pretty(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
