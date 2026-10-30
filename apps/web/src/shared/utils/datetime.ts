/**
 * 后端时间统一是 UTC（SQLite 存 naive datetime，JSON 不带时区）。
 * 前端展示前补 Z 再转本地时区，避免与本地日志相差 8 小时。
 */
export function parseServerTime(value?: string | null): Date | null {
  if (!value) return null;
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const date = new Date(hasZone ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value?: string | null): string {
  const date = parseServerTime(value);
  if (!date) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatClock(value?: string | null): string {
  const date = parseServerTime(value);
  if (!date) return '--:--:--';
  return date.toTimeString().slice(0, 8);
}
