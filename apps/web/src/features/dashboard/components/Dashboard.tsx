import { Alert, App, Button, Select, Skeleton } from 'antd';
import {
  ArrowRight,
  CaretRight,
  ChartLine,
  Check,
  CheckCircle,
  Clock,
  Coins,
  Envelope,
  Lightning,
  Newspaper,
  Play,
  Plus,
  Sparkle,
  SquaresFour,
  Target,
  Timer,
  User,
  Warning,
  XCircle,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';

import { useAuthStore } from '@/features/auth/hooks/useAuthStore';
import EChart from '@/shared/components/charts/EChart';
import EmptyState from '@/shared/components/EmptyState';
import { Card, Pill, SectionHeader, StatCard } from '@/shared/components/ui';
import type { PillTone } from '@/shared/components/ui';
import { parseServerTime } from '@/shared/utils/datetime';
import {
  createBlankWorkflow,
  fetchDashboardRuns,
  fetchDashboardWorkflows,
  fetchWorkspace,
} from '../api';
import type { RunListItem, WorkflowListItem } from '../api';
import './Dashboard.css';

type Period = 'week' | 'month' | 'quarter';
type TrendDays = 7 | 14 | 30;

const PERIOD_LABEL: Record<Period, string> = {
  week: '本周',
  month: '本月',
  quarter: '本季度',
};

const RUN_STATUS: Record<string, { label: string; tone: PillTone; icon: ReactNode }> = {
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

const HOT_ICONS = [
  <Target size={16} key="target" />,
  <ChartLine size={16} key="chart" />,
  <Newspaper size={16} key="news" />,
  <Envelope size={16} key="mail" />,
];

const HOT_STYLES = [
  { background: 'rgba(59,130,246,0.2)', color: '#3B82F6' },
  { background: 'rgba(139,92,246,0.2)', color: '#A78BFA' },
  { background: 'rgba(245,158,11,0.2)', color: '#F59E0B' },
  { background: 'rgba(6,182,212,0.2)', color: '#22D3EE' },
];

const PIE_COLORS = ['#3B82F6', '#8B5CF6', '#22C55E', '#F59E0B', '#64748B'];

function startOfPeriod(period: Period): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  if (period === 'week') {
    date.setDate(date.getDate() - 6);
  } else if (period === 'month') {
    date.setDate(1);
  } else {
    date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1);
  }
  return date;
}

function previousPeriodStart(period: Period, currentStart: Date): Date {
  const date = new Date(currentStart);
  if (period === 'week') {
    date.setDate(date.getDate() - 7);
  } else if (period === 'month') {
    date.setMonth(date.getMonth() - 1);
  } else {
    date.setMonth(date.getMonth() - 3);
  }
  return date;
}

function durationText(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.round(seconds % 60)}s`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatRunTime(value?: string | null): string {
  const date = parseServerTime(value);
  if (!date) return '—';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function trendHint(current: number, previous: number): string {
  if (previous === 0) return `上期 ${previous}`;
  const delta = percentDelta(current, previous) ?? 0;
  return `较上期 ${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% · 上期 ${previous}`;
}

function triggerMeta(trigger?: string | null) {
  return (
    TRIGGER_META[trigger || ''] ?? {
      label: trigger || '—',
      tone: 'neutral' as PillTone,
      icon: null,
    }
  );
}

export default function Dashboard() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const user = useAuthStore((s) => s.user);

  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const [trendDays, setTrendDays] = useState<TrendDays>(7);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [runList, workflowList, workspace] = await Promise.all([
        fetchDashboardRuns(),
        fetchDashboardWorkflows(),
        wsId ? fetchWorkspace(wsId) : Promise.resolve(null),
      ]);
      setRuns(runList);
      setWorkflows(workflowList);
      if (workspace) setWorkspaceName(workspace.name);
    } catch (err: any) {
      setLoadError(err?.message || '加载 Dashboard 失败');
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodStart = useMemo(() => startOfPeriod(period), [period]);
  const previousStart = useMemo(
    () => previousPeriodStart(period, periodStart),
    [period, periodStart],
  );

  const periodRuns = useMemo(
    () =>
      runs.filter((run) => {
        const started = parseServerTime(run.started_at);
        return started !== null && started >= periodStart;
      }),
    [runs, periodStart],
  );

  const previousRuns = useMemo(
    () =>
      runs.filter((run) => {
        const started = parseServerTime(run.started_at);
        return started !== null && started >= previousStart && started < periodStart;
      }),
    [runs, previousStart, periodStart],
  );

  const periodStats = useMemo(() => {
    const success = periodRuns.filter((run) => run.status === 'success').length;
    const failed = periodRuns.filter((run) => run.status === 'failed').length;
    const running = periodRuns.filter((run) => run.status === 'running').length;
    const finished = success + failed;
    return {
      total: periodRuns.length,
      success,
      failed,
      running,
      successRate: finished > 0 ? (success / finished) * 100 : null,
      tokens: periodRuns.reduce((sum, run) => sum + (run.total_tokens || 0), 0),
    };
  }, [periodRuns]);

  const previousStats = useMemo(() => {
    const success = previousRuns.filter((run) => run.status === 'success').length;
    const failed = previousRuns.filter((run) => run.status === 'failed').length;
    const finished = success + failed;
    return {
      total: previousRuns.length,
      successRate: finished > 0 ? (success / finished) * 100 : null,
      tokens: previousRuns.reduce((sum, run) => sum + (run.total_tokens || 0), 0),
    };
  }, [previousRuns]);

  const activeWorkflows = useMemo(
    () =>
      workflows.filter((workflow) => {
        const lastRun = parseServerTime(workflow.last_run_at);
        return lastRun !== null && lastRun >= periodStart;
      }).length,
    [workflows, periodStart],
  );

  const publishedWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.published_version_id).length,
    [workflows],
  );

  const trend = useMemo(() => {
    const days: { label: string; count: number; successRate: number | null }[] = [];
    for (let offset = trendDays - 1; offset >= 0; offset -= 1) {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      dayStart.setDate(dayStart.getDate() - offset);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const dayRuns = runs.filter((run) => {
        const started = parseServerTime(run.started_at);
        return started !== null && started >= dayStart && started < dayEnd;
      });
      const success = dayRuns.filter((run) => run.status === 'success').length;
      const failed = dayRuns.filter((run) => run.status === 'failed').length;
      const finished = success + failed;
      days.push({
        label: `${dayStart.getMonth() + 1}/${dayStart.getDate()}`,
        count: dayRuns.length,
        successRate: finished > 0 ? Math.round((success / finished) * 1000) / 10 : null,
      });
    }
    return days;
  }, [runs, trendDays]);

  const trendOption = useMemo<EChartsCoreOption>(
    () => ({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1B2336',
        borderColor: '#334155',
        textStyle: { color: '#F8FAFC', fontSize: 12 },
      },
      legend: {
        data: ['运行次数', '成功率'],
        textStyle: { color: '#94A3B8', fontSize: 11 },
        top: 0,
        right: 0,
      },
      grid: { left: 40, right: 44, top: 32, bottom: 28 },
      xAxis: {
        type: 'category',
        data: trend.map((day) => day.label),
        axisLine: { lineStyle: { color: '#334155' } },
        axisTick: { show: false },
        axisLabel: { color: '#94A3B8', fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          name: '次数',
          nameTextStyle: { color: '#64748B', fontSize: 10 },
          splitLine: { lineStyle: { color: '#273248' } },
          axisLabel: { color: '#94A3B8', fontSize: 11 },
        },
        {
          type: 'value',
          name: '%',
          min: 0,
          max: 100,
          nameTextStyle: { color: '#64748B', fontSize: 10 },
          splitLine: { show: false },
          axisLabel: { color: '#94A3B8', fontSize: 11, formatter: '{value}%' },
        },
      ],
      series: [
        {
          name: '运行次数',
          type: 'bar',
          data: trend.map((day) => day.count),
          itemStyle: { color: '#3B82F6', borderRadius: [3, 3, 0, 0] },
          barWidth: 16,
        },
        {
          name: '成功率',
          type: 'line',
          yAxisIndex: 1,
          data: trend.map((day) => day.successRate),
          smooth: true,
          connectNulls: true,
          lineStyle: { color: '#22C55E', width: 2 },
          itemStyle: { color: '#22C55E' },
          symbolSize: 5,
        },
      ],
    }),
    [trend],
  );

  const tokenDistribution = useMemo(() => {
    const map = new Map<string, { name: string; value: number }>();
    for (const run of periodRuns) {
      const tokens = run.total_tokens || 0;
      if (tokens <= 0) continue;
      const existing = map.get(run.workflow_id);
      if (existing) existing.value += tokens;
      else map.set(run.workflow_id, { name: run.workflow_name, value: tokens });
    }
    const all = Array.from(map.values()).sort((a, b) => b.value - a.value);
    const total = all.reduce((sum, item) => sum + item.value, 0);
    const items = all.slice(0, 4);
    if (all.length > 4) {
      items.push({
        name: '其他',
        value: all.slice(4).reduce((sum, item) => sum + item.value, 0),
      });
    }
    return { items, total };
  }, [periodRuns]);

  const tokenOption = useMemo<EChartsCoreOption>(
    () => ({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1B2336',
        borderColor: '#334155',
        textStyle: { color: '#F8FAFC', fontSize: 12 },
        formatter: '{b}: {c} tokens ({d}%)',
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'center',
        textStyle: { color: '#94A3B8', fontSize: 11 },
        itemWidth: 10,
        itemHeight: 10,
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '80%'],
          center: ['38%', '50%'],
          itemStyle: { borderRadius: 4, borderColor: '#1B2336', borderWidth: 2 },
          label: { show: false },
          data: tokenDistribution.items.map((item, index) => ({
            ...item,
            itemStyle: { color: PIE_COLORS[index % PIE_COLORS.length] },
          })),
        },
      ],
    }),
    [tokenDistribution],
  );

  const hotWorkflows = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        count: number;
        success: number;
        finished: number;
        duration: number;
        durationCount: number;
        lastStatus: string;
      }
    >();

    for (const run of periodRuns) {
      let entry = map.get(run.workflow_id);
      if (!entry) {
        entry = {
          id: run.workflow_id,
          name: run.workflow_name,
          count: 0,
          success: 0,
          finished: 0,
          duration: 0,
          durationCount: 0,
          lastStatus: run.status,
        };
        map.set(run.workflow_id, entry);
      }
      entry.count += 1;
      if (run.status === 'success') {
        entry.success += 1;
        entry.finished += 1;
      }
      if (run.status === 'failed') entry.finished += 1;
      if (run.duration_ms != null) {
        entry.duration += run.duration_ms;
        entry.durationCount += 1;
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [periodRuns]);

  const recentRuns = runs.slice(0, 6);
  const latestSuccess = runs.find((run) => run.status === 'success');
  const latestFailed = runs.find((run) => run.status === 'failed');
  const runningCount = runs.filter((run) => run.status === 'running').length;

  const handleCreate = async () => {
    setCreating(true);
    try {
      const workflow = await createBlankWorkflow();
      navigate(`${wsPrefix}/workflows/${workflow.id}`);
    } catch (err: any) {
      message.error(err?.message || '创建工作流失败');
    } finally {
      setCreating(false);
    }
  };

  if (loading && runs.length === 0 && workflows.length === 0) {
    return (
      <div className="af-dash__loading">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载 Dashboard 失败"
        description={loadError}
        action={
          <Button size="small" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  }

  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const displayName = user?.name || '朋友';

  const focusItems = [
    latestSuccess
      ? {
          key: 'success',
          tone: 'success',
          icon: <Check size={16} />,
          label: '最近一次运行成功',
          title: `${latestSuccess.workflow_name} · #${latestSuccess.id.replace(/^r_/, '')}`,
          hint: `${formatRunTime(latestSuccess.started_at)} · 耗时 ${durationText(latestSuccess.duration_ms)}`,
          onClick: () => navigate(`${wsPrefix}/runs/${latestSuccess.id}`),
        }
      : {
          key: 'success-empty',
          tone: 'success',
          icon: <Check size={16} />,
          label: '运行状态',
          title: '还没有成功运行',
          hint: '去工作流页面发起第一次运行',
          onClick: () => navigate(`${wsPrefix}/workflows`),
        },
    latestFailed
      ? {
          key: 'failed',
          tone: 'danger',
          icon: <Warning size={16} />,
          label: '工作流失败待处理',
          title: `${latestFailed.workflow_name} · #${latestFailed.id.replace(/^r_/, '')}`,
          hint: `${formatRunTime(latestFailed.started_at)} · 点击查看诊断`,
          onClick: () => navigate(`${wsPrefix}/runs/${latestFailed.id}`),
        }
      : {
          key: 'failed-empty',
          tone: 'success',
          icon: <CheckCircle size={16} />,
          label: '失败告警',
          title: '暂无失败运行',
          hint: '最近运行状态健康',
          onClick: () => navigate(`${wsPrefix}/runs`),
        },
    runningCount > 0
      ? {
          key: 'running',
          tone: 'brand',
          icon: <Play size={16} />,
          label: '正在运行',
          title: `${runningCount} 个运行进行中`,
          hint: '运行状态每 2 秒自动刷新',
          onClick: () => navigate(`${wsPrefix}/runs`),
        }
      : {
          key: 'published',
          tone: 'warning',
          icon: <SquaresFour size={16} />,
          label: '已发布工作流',
          title: `${publishedWorkflows} 个工作流已发布`,
          hint: `共 ${workflows.length} 个工作流`,
          onClick: () => navigate(`${wsPrefix}/workflows`),
        },
  ];

  const successRateHint =
    periodStats.successRate === null
      ? '暂无完成运行'
      : previousStats.successRate === null
        ? '上期无完成运行'
        : `较上期 ${periodStats.successRate >= previousStats.successRate ? '↑' : '↓'} ${Math.abs(
            periodStats.successRate - previousStats.successRate,
          ).toFixed(1)}%`;

  return (
    <div>
      <div className="af-dash__header">
        <div>
          <h1 className="af-dash__title">Dashboard</h1>
          <div className="af-dash__subtitle">
            你好 {displayName}，今天是 {dateLabel} · {workspaceName || '当前'} 工作空间
          </div>
        </div>
        <div className="af-dash__actions">
          <Select<Period>
            size="small"
            value={period}
            style={{ width: 104 }}
            onChange={setPeriod}
            options={[
              { value: 'month', label: '本月' },
              { value: 'week', label: '本周' },
              { value: 'quarter', label: '本季度' },
            ]}
          />
          <Button
            type="primary"
            size="small"
            icon={<Plus size={14} />}
            loading={creating}
            onClick={() => void handleCreate()}
          >
            新建工作流
          </Button>
        </div>
      </div>

      <Card className="af-dash__focus">
        <div className="af-dash__focus-head">
          <Sparkle size={15} weight="fill" />
          <span>今日焦点</span>
        </div>
        <div className="af-dash__focus-grid">
          {focusItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="af-dash__focus-item"
              onClick={item.onClick}
            >
              <span className={`af-dash__focus-icon af-dash__focus-icon--${item.tone}`}>
                {item.icon}
              </span>
              <span className="af-dash__focus-text">
                <span className="af-dash__focus-label">{item.label}</span>
                <span className="af-dash__focus-title">{item.title}</span>
                <span className="af-dash__focus-hint">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <div className="af-dash__kpis">
        <StatCard
          label={`${PERIOD_LABEL[period]}运行次数`}
          value={periodStats.total}
          hint={trendHint(periodStats.total, previousStats.total)}
          icon={<Play size={16} />}
        />
        <StatCard
          label="成功率"
          value={periodStats.successRate === null ? '—' : `${periodStats.successRate.toFixed(1)}%`}
          hint={successRateHint}
          icon={<CheckCircle size={16} />}
        />
        <StatCard
          label="Token 消耗"
          value={
            <>
              {formatTokens(periodStats.tokens)}
              <small>tokens</small>
            </>
          }
          hint={
            periodStats.tokens === 0
              ? 'Token 计量数据待接入'
              : trendHint(periodStats.tokens, previousStats.tokens)
          }
          icon={<Coins size={16} />}
        />
        <StatCard
          label="活跃工作流"
          value={
            <>
              {activeWorkflows}
              <small>/ 已发布 {publishedWorkflows}</small>
            </>
          }
          hint={`共 ${workflows.length} 个工作流`}
          icon={<SquaresFour size={16} />}
        />
      </div>

      <div className="af-dash__charts">
        <Card className="af-dash__chart-card" padded>
          <SectionHeader
            title="运行趋势"
            description="运行次数柱状 · 成功率折线 · 按天显示"
            extra={
              <div className="af-dash__range-tabs">
                {([7, 14, 30] as TrendDays[]).map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`af-dash__range${trendDays === days ? ' is-active' : ''}`}
                    onClick={() => setTrendDays(days)}
                  >
                    {days} 天
                  </button>
                ))}
              </div>
            }
          />
          <EChart option={trendOption} height={240} />
        </Card>

        <Card className="af-dash__chart-card" padded>
          <SectionHeader
            title="Token 分布"
            description={`按工作流 · ${PERIOD_LABEL[period]}合计 ${formatTokens(tokenDistribution.total)} tokens`}
          />
          {tokenDistribution.total === 0 ? (
            <div className="af-dash__chart-empty">
              <Coins size={22} />
              <span>暂无 Token 计量数据</span>
              <small>计量能力上线后自动展示</small>
            </div>
          ) : (
            <EChart option={tokenOption} height={240} />
          )}
        </Card>
      </div>

      <div className="af-dash__bottom">
        <Card padded>
          <SectionHeader
            title="热门工作流"
            extra={
              <button
                type="button"
                className="af-dash__link"
                onClick={() => navigate(`${wsPrefix}/workflows`)}
              >
                查看全部 <ArrowRight size={11} />
              </button>
            }
          />
          {hotWorkflows.length === 0 ? (
            <EmptyState
              title="还没有运行记录"
              description="运行工作流后，这里会展示热度排名。"
              action={
                <Button size="small" onClick={() => navigate(`${wsPrefix}/workflows`)}>
                  去工作流
                </Button>
              }
            />
          ) : (
            <div>
              {hotWorkflows.map((workflow, index) => {
                const meta = RUN_STATUS[workflow.lastStatus] ?? RUN_STATUS.running;
                const successRate =
                  workflow.finished > 0
                    ? `${Math.round((workflow.success / workflow.finished) * 100)}%`
                    : '—';
                const averageDuration =
                  workflow.durationCount > 0
                    ? durationText(workflow.duration / workflow.durationCount)
                    : '—';
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    className="af-dash__hot-item"
                    onClick={() => navigate(`${wsPrefix}/workflows/${workflow.id}`)}
                  >
                    <span
                      className="af-dash__hot-icon"
                      style={HOT_STYLES[index % HOT_STYLES.length]}
                    >
                      {HOT_ICONS[index % HOT_ICONS.length]}
                    </span>
                    <span className="af-dash__hot-main">
                      <span className="af-dash__hot-name">
                        <span>{workflow.name}</span>
                        <Pill tone={meta.tone}>{meta.label}</Pill>
                      </span>
                      <span className="af-dash__hot-meta">
                        <span>
                          <Play size={11} /> {workflow.count} 次
                        </span>
                        <span>
                          <CheckCircle size={11} /> {successRate}
                        </span>
                        <span>
                          <Timer size={11} /> {averageDuration}
                        </span>
                      </span>
                    </span>
                    <CaretRight size={14} className="af-dash__caret" />
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card padded>
          <SectionHeader
            title="最近运行"
            extra={
              <button
                type="button"
                className="af-dash__link"
                onClick={() => navigate(`${wsPrefix}/runs`)}
              >
                查看全部 <ArrowRight size={11} />
              </button>
            }
          />
          {recentRuns.length === 0 ? (
            <EmptyState
              title="还没有运行记录"
              description="打开一个工作流并运行后，这里会出现记录。"
              action={
                <Button size="small" onClick={() => navigate(`${wsPrefix}/workflows`)}>
                  去工作流
                </Button>
              }
            />
          ) : (
            <>
              <div className="af-dash__run-head">
                <span>状态</span>
                <span>运行 ID</span>
                <span>工作流</span>
                <span>触发方式</span>
                <span style={{ textAlign: 'right' }}>耗时</span>
                <span />
              </div>
              {recentRuns.map((run) => {
                const status = RUN_STATUS[run.status] ?? RUN_STATUS.running;
                const trigger = triggerMeta(run.trigger);
                return (
                  <button
                    key={run.id}
                    type="button"
                    className="af-dash__run-row"
                    onClick={() => navigate(`${wsPrefix}/runs/${run.id}`)}
                  >
                    <Pill tone={status.tone} className="af-dash__run-status" title={status.label}>
                      {status.icon}
                    </Pill>
                    <span className="af-dash__run-id">#{run.id.replace(/^r_/, '')}</span>
                    <span className="af-dash__run-name">{run.workflow_name}</span>
                    <Pill tone={trigger.tone} icon={trigger.icon} className="af-dash__run-trigger">
                      {trigger.label}
                    </Pill>
                    <span className="af-dash__run-duration">
                      {run.status === 'running' ? '运行中…' : durationText(run.duration_ms)}
                    </span>
                    <CaretRight size={14} className="af-dash__caret" />
                  </button>
                );
              })}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
