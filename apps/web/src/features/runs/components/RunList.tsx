import { Alert, App, Button, Checkbox, DatePicker, Select, Skeleton } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  ArrowClockwise,
  CaretRight,
  Check,
  Clock,
  DownloadSimple,
  Lightning,
  Play,
  User,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import EmptyState from '@/shared/components/EmptyState';
import { Card, IconButton, Pill } from '@/shared/components/ui';
import type { PillTone } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils/datetime';
import { listRuns, listWorkflowOptions, rerunRun } from '../api';
import type { RunListItem, WorkflowOption } from '../api';
import './RunList.css';

const { RangePicker } = DatePicker;

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'waiting_input', label: '等待输入' },
  { value: 'running', label: '运行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

const STATUS_META: Record<string, { label: string; tone: PillTone; icon: ReactNode }> = {
  success: { label: '成功', tone: 'success', icon: <Check size={11} /> },
  failed: { label: '失败', tone: 'danger', icon: <XCircle size={11} /> },
  running: { label: '运行中', tone: 'brand', icon: <Play size={11} /> },
  cancelled: { label: '已取消', tone: 'neutral', icon: <Warning size={11} /> },
  waiting_input: { label: '等待输入', tone: 'warning', icon: <Clock size={11} /> },
};

const TRIGGER_META: Record<string, { label: string; tone: PillTone; icon: ReactNode }> = {
  manual: { label: '手动', tone: 'brand', icon: <User size={10} /> },
  scheduled: { label: '定时', tone: 'neutral', icon: <Clock size={10} /> },
  debug: { label: '调试', tone: 'violet', icon: <Lightning size={10} /> },
  api: { label: 'Webhook', tone: 'warning', icon: <Lightning size={10} /> },
};

function durationText(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.round(seconds % 60)}s`;
}

function tokenText(value: number): string {
  if (!value) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** 后端用 naive UTC 存储，查询参数也传去掉 Z 的 UTC 字符串 */
function toNaiveUtc(value?: Dayjs | null): string | undefined {
  if (!value) return undefined;
  return value.toISOString().replace('Z', '');
}

function downloadCsv(items: RunListItem[]) {
  const header = ['运行ID', '工作流', '状态', '触发方式', '开始时间', '耗时(ms)', 'Token'];
  const rows = items.map((run) => [
    run.id,
    run.workflow_name,
    STATUS_META[run.status]?.label || run.status,
    TRIGGER_META[run.trigger]?.label || run.trigger,
    formatDateTime(run.started_at),
    run.duration_ms ?? '',
    run.total_tokens || 0,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'agentflow-runs.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function RunList() {
  const { message } = App.useApp();
  const nav = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const [items, setItems] = useState<RunListItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  // 对比：最多勾两条（F1）
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listRuns({
        status: status || undefined,
        workflow_id: workflowId,
        started_after: toNaiveUtc(range?.[0]?.startOf('day')),
        started_before: toNaiveUtc(range?.[1]?.endOf('day')),
      });
      setItems(data);
    } catch (err: any) {
      setLoadError(err?.message || '加载运行记录失败');
      message.error(err?.message || '加载运行记录失败');
    } finally {
      setLoading(false);
    }
  }, [status, workflowId, range, message]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    listWorkflowOptions()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, []);

  const handleRerun = async (id: string) => {
    setRerunning(id);
    try {
      const run = await rerunRun(id);
      message.success(`已重新发起运行 ${run.id}`);
      nav(`${wsPrefix}/runs/${run.id}`);
    } catch (err: any) {
      message.error(err?.message || '重新运行失败');
    } finally {
      setRerunning(null);
    }
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelected((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id].slice(0, 2);
      return prev.filter((item) => item !== id);
    });
  };

  const successCount = items.filter((run) => run.status === 'success').length;
  const finishedCount = items.filter(
    (run) => run.status === 'success' || run.status === 'failed',
  ).length;
  const successRate = finishedCount > 0 ? (successCount / finishedCount) * 100 : null;

  return (
    <div>
      <div className="af-rl__header">
        <div>
          <h1 className="af-rl__title">运行记录</h1>
          <div className="af-rl__subtitle">
            共 {items.length} 次 · 成功率 {successRate === null ? '—' : `${successRate.toFixed(1)}%`}
          </div>
        </div>
        <div className="af-rl__actions">
          <Select
            value={status}
            style={{ width: 120 }}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
          <Select
            allowClear
            placeholder="全部工作流"
            style={{ width: 170 }}
            value={workflowId}
            options={workflows.map((wf) => ({ value: wf.id, label: wf.name }))}
            onChange={(value) => setWorkflowId(value)}
          />
          <RangePicker
            value={range}
            onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null] | null)}
          />
          <Button
            disabled={selected.length !== 2}
            onClick={() => nav(`${wsPrefix}/runs/compare?ids=${selected.join(',')}`)}
          >
            对比选中{selected.length ? `（${selected.length}）` : ''}
          </Button>
          <IconButton label="刷新" icon={<ArrowClockwise size={16} />} onClick={() => void load()} />
          <Button
            type="primary"
            icon={<DownloadSimple size={14} />}
            disabled={items.length === 0}
            onClick={() => downloadCsv(items)}
          >
            导出
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载运行记录失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      <Card className="af-rl__table">
        <div className="af-rl__row af-rl__head">
          <span />
          <span>状态</span>
          <span>运行 ID</span>
          <span>工作流</span>
          <span>触发方式</span>
          <span>开始时间</span>
          <span style={{ textAlign: 'right' }}>耗时</span>
          <span style={{ textAlign: 'right' }}>Token</span>
          <span />
        </div>

        {loading && items.length === 0 ? (
          <div className="af-rl__loading">
            <Skeleton active paragraph={{ rows: 8 }} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="还没有运行记录"
            description="打开一个工作流，点「运行」后这里会出现记录。"
            action={<Button onClick={() => nav(`${wsPrefix}/workflows`)}>去工作流</Button>}
          />
        ) : (
          items.map((run) => {
            const meta = STATUS_META[run.status] ?? STATUS_META.running;
            const trigger = TRIGGER_META[run.trigger] ?? {
              label: run.trigger,
              tone: 'neutral' as PillTone,
              icon: null,
            };
            const checked = selected.includes(run.id);
            return (
              <div
                key={run.id}
                className="af-rl__row"
                role="button"
                tabIndex={0}
                onClick={() => nav(`${wsPrefix}/runs/${run.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    nav(`${wsPrefix}/runs/${run.id}`);
                  }
                }}
              >
                <span onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={checked}
                    disabled={!checked && selected.length >= 2}
                    aria-label={`选择运行 ${run.id}`}
                    onChange={(event) => toggleSelected(run.id, event.target.checked)}
                  />
                </span>
                <Pill tone={meta.tone} className="af-rl__status" title={meta.label}>
                  {meta.icon}
                </Pill>
                <span className="af-rl__id">#{run.id.replace(/^r_/, '')}</span>
                <span className="af-rl__name">{run.workflow_name}</span>
                <Pill tone={trigger.tone} icon={trigger.icon}>
                  {trigger.label}
                </Pill>
                <span className="af-rl__time">{formatDateTime(run.started_at)}</span>
                <span className="af-rl__mono" style={{ textAlign: 'right' }}>
                  {run.status === 'running' ? '运行中…' : durationText(run.duration_ms)}
                </span>
                <span className="af-rl__mono" style={{ textAlign: 'right' }}>
                  {tokenText(run.total_tokens)}
                </span>
                <span className="af-rl__row-actions">
                  <IconButton
                    label="以此配置重跑"
                    icon={<ArrowClockwise size={13} />}
                    disabled={rerunning === run.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRerun(run.id);
                    }}
                  />
                  <CaretRight size={14} className="af-rl__caret" />
                </span>
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
