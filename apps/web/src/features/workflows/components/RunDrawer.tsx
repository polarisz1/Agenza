import type { RunLogEntry, LiveStatus } from '@/features/runs/hooks/useRunStream';
import './WorkflowEditor.css';

interface Props {
  runId: string | null;
  status: LiveStatus;
  logs: RunLogEntry[];
  durationMs: number | null;
  totalTokens: number;
  error: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onClear: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  idle: '未运行',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

function formatTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

function renderLog(entry: RunLogEntry) {
  const time = <span className="afe-log-time">{formatTime(entry.at)}</span>;
  const data = entry.data || {};

  if (entry.event === 'run.started') {
    return <div key={entry.id}>{time}▶ 运行开始</div>;
  }

  if (entry.event === 'node.started') {
    return (
      <div key={entry.id}>
        {time} ↳ {data.node_name} <span className="afe-log-run">… 执行中</span>
      </div>
    );
  }

  if (entry.event === 'node.finished') {
    const status = data.status;
    const cls =
      status === 'success'
        ? 'afe-log-ok'
        : status === 'cancelled' || status === 'skipped'
          ? 'afe-log-cancel'
          : 'afe-log-fail';
    const mark =
      status === 'success'
        ? '✓'
        : status === 'skipped'
          ? '⊘ 跳过'
          : status === 'cancelled'
            ? '⊘ 已取消'
            : '✗';
    return (
      <div key={entry.id}>
        {time} ↳ {data.node_name}{' '}
        <span className={cls}>
          {mark} {data.duration_ms ?? 0}ms
        </span>
        {data.model ? ` · ${data.model}` : ''}
        {data.tokens_in || data.tokens_out ? ` · ${data.tokens_in}→${data.tokens_out} tokens` : ''}
        {data.error ? <span className="afe-log-fail"> · {data.error}</span> : ''}
      </div>
    );
  }

  if (entry.event === 'run.finished') {
    const ok = data.status === 'success';
    return (
      <div key={entry.id}>
        {time}{' '}
        <span
          className={
            ok ? 'afe-log-ok' : data.status === 'cancelled' ? 'afe-log-cancel' : 'afe-log-fail'
          }
        >
          {ok ? '✓ 运行完成' : data.status === 'cancelled' ? '⊘ 运行已取消' : '✗ 运行失败'}
        </span>
        {data.duration_ms != null ? ` · 总耗时 ${(data.duration_ms / 1000).toFixed(1)}s` : ''}
        {data.total_tokens ? ` · ${data.total_tokens.toLocaleString()} tokens` : ''}
        {data.error ? ` · ${data.error}` : ''}
      </div>
    );
  }

  return null;
}

/** 底部运行抽屉：实时节点日志 + 运行控制 */
export default function RunDrawer({
  runId,
  status,
  logs,
  durationMs,
  totalTokens,
  error,
  collapsed,
  onToggle,
  onCancel,
  onClear,
}: Props) {
  return (
    <div className={collapsed ? 'afe-runpanel afe-runpanel--collapsed' : 'afe-runpanel'}>
      <div className="afe-runpanel-head">
        <div className="afe-runpanel-title">
          <span className={`afe-dot afe-dot--${status}`} />
          {runId ? `运行 #${runId}` : '未运行'} · {STATUS_LABEL[status] ?? status}
          {durationMs != null && status !== 'running'
            ? ` · ${(durationMs / 1000).toFixed(1)}s`
            : ''}
          {totalTokens ? ` · ${totalTokens.toLocaleString()} tokens` : ''}
          {error && <span className="afe-log-fail"> · {error}</span>}
        </div>
        <div className="afe-runpanel-actions">
          {status === 'running' && (
            <button className="afe-btn afe-btn--text" onClick={onCancel}>
              取消
            </button>
          )}
          <button className="afe-btn afe-btn--text" onClick={onClear}>
            清空
          </button>
          <button className="afe-btn afe-btn--text" onClick={onToggle}>
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="afe-runpanel-body">
          {logs.length === 0 ? (
            <div className="afe-runpanel-empty">
              点击「▶ 运行」发起一次运行，节点状态会在这里实时更新。
            </div>
          ) : (
            logs.map(renderLog)
          )}
        </div>
      )}
    </div>
  );
}
