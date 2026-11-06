import { Alert, App, Button, Spin } from 'antd';
import {
  ArrowLeft,
  CheckCircle,
  Coins,
  Lightbulb,
  Play,
  Sparkle,
  Timer,
} from '@phosphor-icons/react';
import type { EChartsCoreOption } from 'echarts/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import EChart from '@/shared/components/charts/EChart';
import EmptyState from '@/shared/components/EmptyState';
import { Card, CodeBlock, Pill, SectionHeader, StatCard, Tabs } from '@/shared/components/ui';
import type { PillTone, TabItem } from '@/shared/components/ui';
import { formatClock, formatDateTime } from '@/shared/utils/datetime';
import {
  analyzeRunDiagnosis,
  getRun,
  getRunDiagnosis,
  getRunDiagnosisTrends,
  listRuns,
  rerunRun,
} from '../api';
import type {
  DeepDiagnosis,
  NodeDiagnosis,
  RunDetail as RunDetailType,
  RunDiagnosis,
  RunDiagnosisTrend,
  RunNodeDetail,
} from '../api';
import { classifyRunError } from '../errors';
import { formatDuration, pretty, statusMeta, triggerLabel } from '../meta';
import './RunView.css';

type NodeTab = 'input' | 'output' | 'error';
type RunTab = 'overview' | 'nodes' | 'cost' | 'diagnostics';

const RUN_TABS: TabItem[] = [
  { key: 'overview', label: '概览' },
  { key: 'nodes', label: '节点执行' },
  { key: 'cost', label: '成本分析' },
  { key: 'diagnostics', label: '调试诊断' },
];

const STATUS_TONE: Record<string, PillTone> = {
  success: 'success',
  failed: 'danger',
  running: 'brand',
  cancelled: 'neutral',
  skipped: 'warning',
  waiting_input: 'warning',
};

const DIAGNOSIS_CATEGORY_LABEL: Record<string, string> = {
  budget: '预算超限',
  auth: '鉴权失败',
  model_not_found: '模型不可用',
  rate_limit: '限流',
  timeout: '超时',
  network: '网络异常',
  provider: '服务商错误',
  json_format: 'JSON 格式',
  missing_fields: '字段缺失',
  variable: '变量解析',
  script: '脚本错误',
  upstream: '上游数据',
  internal: '内部错误',
  unknown: '未知错误',
};

const DIAGNOSIS_ACTION_LABEL: Record<string, string> = {
  edit_prompt: '去编辑节点',
  open_node: '打开节点',
  retry_node: '重新运行',
  open_models: '模型配置',
  open_gateway: 'AI Gateway',
};

const NODE_COLORS: Record<string, string> = {
  input: '#3B82F6',
  llm: '#3B82F6',
  extract: '#8B5CF6',
  http: '#06B6D4',
  python: '#EF4444',
  condition: '#A855F7',
  merge: '#64748B',
  output: '#22C55E',
};

function statusTone(status: string): PillTone {
  return STATUS_TONE[status] ?? 'neutral';
}

function copyText(text: string, message: { success: (content: string) => void }) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => message.success('已复制'))
    .catch(() => message.success('复制失败：请手动选择文本'));
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function nodeTokens(node: RunNodeDetail): number {
  return (node.tokens_in || 0) + (node.tokens_out || 0);
}

/** 运行详情 v3：概览 / 节点 / 成本 / 诊断四视图（对齐原型诊断控制台）。 */
export default function RunDetail() {
  const { id, wsId } = useParams<{ id: string; wsId: string }>();
  const nav = useNavigate();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const { message } = App.useApp();

  const [run, setRun] = useState<RunDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Record<string, NodeTab>>({});
  const [tab, setTab] = useState<RunTab>('overview');
  const [rerunning, setRerunning] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<RunDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [deepAnalysis, setDeepAnalysis] = useState<DeepDiagnosis | null>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  const [trend, setTrend] = useState<RunDiagnosisTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const trendWorkflowRef = useRef<string | null>(null);

  const loadDiagnosis = useCallback(async (runId: string) => {
    setDiagnosisLoading(true);
    setDiagnosisError(null);
    setDiagnosis(null);
    try {
      setDiagnosis(await getRunDiagnosis(runId));
    } catch (err: any) {
      // 接口不可用时退回本地规则分类，诊断页仍可用
      setDiagnosis(null);
      setDiagnosisError(err?.message || '自动根因分析暂不可用');
    } finally {
      setDiagnosisLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getRun(id);
      setRun(data);
      setLoadError(null);
      const isFirstLoad = currentIdRef.current !== id;
      currentIdRef.current = id;

      if (isFirstLoad) {
        setDeepAnalysis(null);
        setDeepError(null);
      }

      if (data.status !== 'running') {
        void loadDiagnosis(data.id);
      } else {
        setDiagnosis(null);
      }

      // 失败节点默认展开（D-14）；首次加载决定初始 tab
      setExpanded((prev) => {
        const next = isFirstLoad ? {} : { ...prev };
        for (const node of data.nodes) {
          if (node.status === 'failed') next[node.node_id] = true;
        }
        return next;
      });
      setTabs((prev) => {
        const next = isFirstLoad ? {} : { ...prev };
        for (const node of data.nodes) {
          if (next[node.node_id]) continue;
          next[node.node_id] =
            node.status === 'failed'
              ? 'error'
              : node.output !== null && node.output !== undefined
                ? 'output'
                : 'input';
        }
        return next;
      });
    } catch (err: any) {
      setLoadError(err?.message || '加载运行详情失败');
    } finally {
      setLoading(false);
    }
  }, [id, loadDiagnosis]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Phase 3：进入诊断 Tab 时按工作流加载跨运行趋势（同一工作流只拉一次）
  const loadTrends = useCallback(async (workflowId: string) => {
    setTrendLoading(true);
    setTrendError(null);
    try {
      setTrend(await getRunDiagnosisTrends({ workflowId, days: 30, top: 5 }));
    } catch (err: any) {
      setTrend(null);
      setTrendError(err?.message || '跨运行趋势加载失败');
    } finally {
      setTrendLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'diagnostics') return;
    const workflowId = run?.workflow_id;
    if (!workflowId || trendWorkflowRef.current === workflowId) return;
    trendWorkflowRef.current = workflowId;
    void loadTrends(workflowId);
  }, [tab, run?.workflow_id, loadTrends]);

  // 运行中每 2s 刷新，结束后停止
  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [run?.status, load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const node of run?.nodes ?? []) {
      result[node.status] = (result[node.status] ?? 0) + 1;
    }
    return result;
  }, [run?.nodes]);

  const tokenStats = useMemo(() => {
    let tokensIn = 0;
    let tokensOut = 0;
    for (const node of run?.nodes ?? []) {
      tokensIn += node.tokens_in || 0;
      tokensOut += node.tokens_out || 0;
    }
    return { tokensIn, tokensOut };
  }, [run?.nodes]);

  const timelineMax = useMemo(
    () => Math.max(...(run?.nodes ?? []).map((node) => node.duration_ms || 0), 1),
    [run?.nodes],
  );

  const slowestNode = useMemo(() => {
    const nodes = run?.nodes ?? [];
    return nodes.reduce<RunNodeDetail | null>((slowest, node) => {
      if (!slowest) return node;
      return (node.duration_ms || 0) > (slowest.duration_ms || 0) ? node : slowest;
    }, null);
  }, [run?.nodes]);

  const snapshotNode = useMemo(() => {
    const nodes = run?.nodes ?? [];
    return nodes.find((node) => node.node_type === 'llm') ?? nodes[0] ?? null;
  }, [run?.nodes]);

  const failedNodes = useMemo(
    () => (run?.nodes ?? []).filter((node) => node.status === 'failed' || Boolean(node.error)),
    [run?.nodes],
  );

  const openNode = (node: RunNodeDetail) => {
    if (!run) return;
    nav(`${wsPrefix}/workflows/${run.workflow_id}?focus=${encodeURIComponent(node.node_id)}`);
  };

  const handleExport = () => {
    if (!run) return;
    downloadJson(`run-${run.id}.json`, run);
  };

  const handleRerun = async () => {
    if (!run) return;
    setRerunning(true);
    try {
      const next = await rerunRun(run.id);
      message.success(`已重新发起运行 ${next.id}`);
      nav(`${wsPrefix}/runs/${next.id}`);
    } catch (err: any) {
      message.error(err?.message || '重新运行失败');
    } finally {
      setRerunning(false);
    }
  };

  const handleCompare = async () => {
    if (!run) return;
    setComparing(true);
    try {
      const recent = await listRuns({ workflow_id: run.workflow_id, limit: 5 });
      const other = recent.find((item) => item.id !== run.id);
      if (!other) {
        message.info('这个工作流还没有另一次运行可以对比');
        return;
      }
      nav(`${wsPrefix}/runs/compare?ids=${other.id},${run.id}`);
    } catch (err: any) {
      message.error(err?.message || '获取对比运行失败');
    } finally {
      setComparing(false);
    }
  };

  const handleDiagnosisAction = (item: NodeDiagnosis, action: string) => {
    if (action === 'retry_node') {
      void handleRerun();
      return;
    }
    if (action === 'open_models') {
      nav(`${wsPrefix}/settings`);
      return;
    }
    if (action === 'open_gateway') {
      nav(`${wsPrefix}/gateway`);
      return;
    }
    // open_node / edit_prompt：能定位到节点就聚焦节点，否则回到工作流
    const node = run?.nodes.find((candidate) => candidate.node_id === item.node_id);
    if (node) {
      openNode(node);
      return;
    }
    if (run) nav(`${wsPrefix}/workflows/${run.workflow_id}`);
  };

  // GATE-04 Phase 2：按需调用模型；refresh=true 表示忽略缓存重新分析
  const handleDeepAnalysis = async (refresh = false) => {
    if (!run) return;
    setDeepLoading(true);
    setDeepError(null);
    try {
      setDeepAnalysis(await analyzeRunDiagnosis(run.id, refresh));
    } catch (err: any) {
      setDeepError(err?.message || 'AI 深度分析失败');
    } finally {
      setDeepLoading(false);
    }
  };

  const trendOption = useMemo<EChartsCoreOption>(() => {
    const points = trend?.points ?? [];
    const percent = (value: number, runs: number) =>
      runs > 0 ? Math.round(value * 1000) / 10 : null;
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1B2336',
        borderColor: '#334155',
        textStyle: { color: '#F8FAFC', fontSize: 12 },
      },
      legend: {
        data: ['运行次数', '成功率', '空输出率'],
        textStyle: { color: '#94A3B8', fontSize: 11 },
        top: 0,
        right: 0,
      },
      grid: { left: 40, right: 48, top: 32, bottom: 26 },
      xAxis: {
        type: 'category',
        data: points.map((point) => point.date.slice(5)),
        axisLine: { lineStyle: { color: '#334155' } },
        axisTick: { show: false },
        axisLabel: { color: '#94A3B8', fontSize: 11 },
      },
      yAxis: [
        {
          type: 'value',
          name: '次数',
          minInterval: 1,
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
          data: points.map((point) => point.runs),
          itemStyle: { color: '#3B82F6', borderRadius: [3, 3, 0, 0] },
          barWidth: 14,
        },
        {
          name: '成功率',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((point) => percent(point.success_rate, point.runs)),
          smooth: true,
          connectNulls: true,
          lineStyle: { color: '#22C55E', width: 2 },
          itemStyle: { color: '#22C55E' },
          symbolSize: 5,
        },
        {
          name: '空输出率',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((point) => percent(point.empty_output_rate, point.runs)),
          smooth: true,
          connectNulls: true,
          lineStyle: { color: '#F59E0B', width: 2, type: 'dashed' },
          itemStyle: { color: '#F59E0B' },
          symbolSize: 5,
        },
      ],
    };
  }, [trend]);

  if (loading && !run) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (loadError && !run) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载运行详情失败"
        description={loadError}
        action={
          <Button size="small" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  }

  if (!run) return <EmptyState title="运行不存在" description="请回到运行记录重新选择。" />;

  const runMeta = statusMeta(run.status);
  const runError = classifyRunError(run.error);
  const showRunError = Boolean(run.error) && run.status !== 'running';
  const slowestPercent =
    slowestNode && run.duration_ms
      ? Math.round(((slowestNode.duration_ms || 0) / run.duration_ms) * 100)
      : null;
  // 后端诊断可用时以后端为准；不可用时回退本地规则（failedNodes）
  const diagnosisCount = diagnosis ? diagnosis.items.length : failedNodes.length;

  return (
    <div className="rv">
      <div className="rv-head">
        <Button type="text" onClick={() => nav(`${wsPrefix}/runs`)}>
          <ArrowLeft size={14} />
          返回
        </Button>
        <div className="rv-head-main">
          <div className="rv-head-title">
            <h1>
              运行 <span className="mono">#{run.id.replace(/^r_/, '')}</span> · {run.workflow_name}
            </h1>
            <Pill tone={statusTone(run.status)}>{runMeta.label}</Pill>
          </div>
          <div className="rv-submeta">
            <span>总耗时 {formatDuration(run.duration_ms)}</span>
            <span>·</span>
            <span>触发 {triggerLabel(run.trigger)}</span>
            <span>·</span>
            <span>开始 {formatDateTime(run.started_at)}</span>
            {run.version_seq && (
              <>
                <span>·</span>
                <span>版本 v{run.version_seq}</span>
              </>
            )}
          </div>
        </div>
        <div className="rv-actions">
          <Button onClick={() => nav(`${wsPrefix}/workflows/${run.workflow_id}`)}>
            打开工作流
          </Button>
          <Button onClick={handleExport} disabled={run.nodes.length === 0}>
            导出日志
          </Button>
          <Button loading={comparing} onClick={() => void handleCompare()}>
            对比上一次
          </Button>
          <Button type="primary" loading={rerunning} onClick={() => void handleRerun()}>
            以此配置重跑
          </Button>
        </div>
      </div>

      <div className="rv-stats">
        <StatCard
          label="总耗时"
          value={formatDuration(run.duration_ms)}
          hint={run.status === 'running' ? '运行中，每 2s 刷新' : '开始 → 结束'}
          icon={<Timer size={16} />}
        />
        <StatCard
          label="节点结果"
          value={
            <>
              {(counts.success ?? 0) + (counts.failed ?? 0) + (counts.skipped ?? 0)}
              <small>/ {run.nodes.length}</small>
            </>
          }
          hint={`成功 ${counts.success ?? 0} · 失败 ${counts.failed ?? 0} · 跳过 ${counts.skipped ?? 0}`}
          icon={<CheckCircle size={16} />}
        />
        <StatCard
          label="Token 消耗"
          value={run.total_tokens.toLocaleString()}
          hint={`输入 ${tokenStats.tokensIn.toLocaleString()} · 输出 ${tokenStats.tokensOut.toLocaleString()}`}
          icon={<Coins size={16} />}
        />
        <StatCard
          label="触发方式"
          value={triggerLabel(run.trigger)}
          hint={formatClock(run.started_at)}
          icon={<Play size={16} />}
        />
      </div>

      {showRunError && (
        <Alert
          type="error"
          showIcon
          message={`运行失败 · ${runError.label}`}
          description={
            <span>
              {run.error}
              <br />
              <span style={{ color: 'var(--af-text-muted)' }}>{runError.suggestion}</span>
            </span>
          }
        />
      )}

      <div className="rv-tabbar">
        <Tabs items={RUN_TABS} value={tab} onChange={(key) => setTab(key as RunTab)} />
      </div>

      {tab === 'overview' && (
        <div className="rv-overview">
          <Card padded>
            <SectionHeader
              title="节点执行时间线"
              description="按节点耗时展示，失败节点会自动标红"
              extra={
                <Button size="small" onClick={() => setTab('nodes')}>
                  查看节点详情
                </Button>
              }
            />
            {run.nodes.length === 0 ? (
              <div className="rv-hint">这次运行没有产生节点记录（可能启动即失败）</div>
            ) : (
              <div className="rv-timeline">
                {run.nodes.map((node) => {
                  const duration = node.duration_ms || 0;
                  const width = Math.max(2, (duration / timelineMax) * 100);
                  return (
                    <div className="rv-timeline-row" key={node.id}>
                      <span className="rv-timeline-name" title={node.node_name}>
                        {node.node_name}
                      </span>
                      <div className="rv-timeline-track">
                        <span
                          className="rv-timeline-bar"
                          style={{
                            width: `${width}%`,
                            background:
                              node.status === 'failed'
                                ? '#EF4444'
                                : node.status === 'skipped'
                                  ? '#64748B'
                                  : NODE_COLORS[node.node_type] || '#64748B',
                          }}
                        />
                      </div>
                      <span className="rv-timeline-meta">
                        {node.status === 'running' ? '运行中…' : formatDuration(duration)}
                      </span>
                      <Pill tone={statusTone(node.status)}>{statusMeta(node.status).label}</Pill>
                    </div>
                  );
                })}
              </div>
            )}
            {slowestNode && slowestNode.duration_ms > 0 && (
              <div className="rv-insight">
                <Lightbulb size={16} />
                <span>
                  <strong>{slowestNode.node_name}</strong>
                  {slowestPercent !== null ? ` 占总耗时 ${slowestPercent}%` : ' 是本次最慢节点'}
                  ，如果是 LLM 节点，可考虑切换更快的模型或调整并发策略。
                </span>
              </div>
            )}
          </Card>

          <div className="rv-snapshots">
            <Card padded>
              <SectionHeader
                title="输入快照"
                description={snapshotNode ? `节点 ${snapshotNode.node_name}` : '暂无节点'}
                extra={
                  snapshotNode && (
                    <Pill tone={statusTone(snapshotNode.status)}>
                      {statusMeta(snapshotNode.status).label}
                    </Pill>
                  )
                }
              />
              {snapshotNode ? (
                <CodeBlock code={pretty(snapshotNode.input)} maxHeight={200} />
              ) : (
                <div className="rv-hint">没有可展示的输入</div>
              )}
            </Card>
            <Card padded>
              <SectionHeader
                title="输出结果"
                description={snapshotNode ? `节点 ${snapshotNode.node_name}` : '暂无节点'}
                extra={
                  snapshotNode && (
                    <Pill tone="neutral">{nodeTokens(snapshotNode).toLocaleString()} tokens</Pill>
                  )
                }
              />
              {snapshotNode ? (
                <CodeBlock code={pretty(snapshotNode.output)} maxHeight={200} />
              ) : (
                <div className="rv-hint">没有可展示的输出</div>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'nodes' && (
        <div className="rv-grid">
          <div className="rv-panel">
            <div className="rv-panel-head">
              节点时间线
              <span className="dim">
                {run.status === 'running' ? '运行中，每 2s 刷新' : '失败节点已自动展开'}
              </span>
              <span className="dim" style={{ marginLeft: 'auto' }}>
                共 {run.nodes.length} 个节点
              </span>
            </div>
            <div className="rv-panel-body flush">
              {run.nodes.length === 0 ? (
                <div className="rv-empty">这次运行没有产生节点记录（可能启动即失败）</div>
              ) : (
                run.nodes.map((node, index) => {
                  const meta = statusMeta(node.status);
                  const nodeError = classifyRunError(node.error);
                  const isOpen = Boolean(expanded[node.node_id]);
                  const nodeTab = tabs[node.node_id] ?? 'output';
                  const hasInput = node.input !== null && node.input !== undefined;
                  const hasOutput = node.output !== null && node.output !== undefined;
                  const hasError = Boolean(node.error) || node.status === 'failed';

                  return (
                    <div
                      className={`rv-node${node.status === 'failed' ? ' rv-node--failed' : ''}`}
                      key={node.id}
                    >
                      <button
                        type="button"
                        className="rv-node-head"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setExpanded((prev) => ({ ...prev, [node.node_id]: !prev[node.node_id] }))
                        }
                      >
                        <span className="idx">{index + 1}</span>
                        <span style={{ color: 'inherit' }}>{meta.symbol}</span>
                        <span className="name">{node.node_name}</span>
                        <Pill tone={statusTone(node.status)}>{meta.label}</Pill>
                        <span className="type">{node.node_type}</span>
                        <span className="meta">
                          {formatDuration(node.duration_ms)}
                          {node.error && node.status !== 'failed' ? ` · ${node.error}` : ''}
                        </span>
                        <span className="chev">{isOpen ? '▾' : '▸'}</span>
                      </button>

                      {isOpen && (
                        <div className="rv-node-body">
                          <div className="rv-tabs">
                            <button
                              type="button"
                              className={`rv-tab${nodeTab === 'input' ? ' on' : ''}`}
                              disabled={!hasInput}
                              onClick={() =>
                                setTabs((prev) => ({ ...prev, [node.node_id]: 'input' }))
                              }
                            >
                              输入
                            </button>
                            <button
                              type="button"
                              className={`rv-tab${nodeTab === 'output' ? ' on' : ''}`}
                              disabled={!hasOutput}
                              onClick={() =>
                                setTabs((prev) => ({ ...prev, [node.node_id]: 'output' }))
                              }
                            >
                              输出
                            </button>
                            <button
                              type="button"
                              className={`rv-tab${nodeTab === 'error' ? ' on' : ''}`}
                              disabled={!hasError}
                              onClick={() =>
                                setTabs((prev) => ({ ...prev, [node.node_id]: 'error' }))
                              }
                            >
                              错误
                            </button>
                          </div>

                          {nodeTab === 'error' && (
                            <div className="rv-error">
                              <div className="rv-error-title">
                                <Pill tone="danger">{nodeError.label}</Pill>
                                <span>{node.error || '节点执行失败（未提供错误信息）'}</span>
                              </div>
                              <div className="rv-error-suggestion">{nodeError.suggestion}</div>
                              <div className="rv-error-actions">
                                <Button size="small" onClick={() => openNode(node)}>
                                  在编辑器中打开
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => copyText(node.error || '', message)}
                                >
                                  复制错误
                                </Button>
                                {nodeError.action?.target === 'models' && (
                                  <Button size="small" onClick={() => nav(`${wsPrefix}/models`)}>
                                    去模型配置
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}

                          {nodeTab === 'input' && (
                            <>
                              <div className="rv-hint">
                                工作流输入 + 直接上游输出（变量解析前的原始值）
                              </div>
                              <pre className="rv-code">{pretty(node.input)}</pre>
                            </>
                          )}

                          {nodeTab === 'output' && (
                            <>
                              {node.output === null || node.output === undefined ? (
                                <div className="rv-hint">
                                  这个节点没有输出（失败 / 跳过 / 取消）
                                </div>
                              ) : (
                                <pre className="rv-code">{pretty(node.output)}</pre>
                              )}
                            </>
                          )}

                          {(hasOutput || hasInput) && (
                            <div className="rv-error-actions">
                              <Button
                                size="small"
                                onClick={() =>
                                  copyText(
                                    pretty(nodeTab === 'input' ? node.input : node.output),
                                    message,
                                  )
                                }
                              >
                                复制当前内容
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rv-side">
            <div className="rv-panel">
              <div className="rv-panel-head">运行输入</div>
              <div className="rv-panel-body">
                {Object.keys(run.inputs ?? {}).length === 0 ? (
                  <div className="rv-hint">这次运行没有输入</div>
                ) : (
                  Object.entries(run.inputs).map(([key, value]) => (
                    <div className="rv-kv" key={key}>
                      <span className="k">{key}</span>
                      <span className="v">{typeof value === 'string' ? value : pretty(value)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rv-panel">
              <div className="rv-panel-head">运行信息</div>
              <div className="rv-panel-body">
                <div className="rv-kv">
                  <span className="k">工作流</span>
                  <span className="v">{run.workflow_name}</span>
                </div>
                <div className="rv-kv">
                  <span className="k">状态</span>
                  <span className="v">{runMeta.label}</span>
                </div>
                <div className="rv-kv">
                  <span className="k">开始</span>
                  <span className="v">{formatDateTime(run.started_at)}</span>
                </div>
                <div className="rv-kv">
                  <span className="k">结束</span>
                  <span className="v">{formatDateTime(run.finished_at)}</span>
                </div>
              </div>
            </div>

            <div className="rv-panel">
              <div className="rv-panel-head">图版本</div>
              <div className="rv-panel-body">
                {run.version_seq ? (
                  <>
                    <div className="rv-kv">
                      <span className="k">运行版本</span>
                      <span className="v">v{run.version_seq}</span>
                    </div>
                    <div className="rv-hint">
                      本次运行使用该版本的图快照；可在编辑器的「版本」里预览或恢复。
                    </div>
                  </>
                ) : (
                  <div className="rv-hint">这次运行早于版本历史功能，未记录版本。</div>
                )}
                <Button
                  size="small"
                  onClick={() => nav(`${wsPrefix}/workflows/${run.workflow_id}`)}
                >
                  打开工作流
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'cost' && (
        <Card padded>
          <SectionHeader
            title="成本分析"
            description={`本次运行共 ${run.total_tokens.toLocaleString()} tokens · 费用计量待接入`}
          />
          <div className="rv-cost">
            <div className="rv-cost-row rv-cost-head">
              <span>节点</span>
              <span>类型</span>
              <span>模型</span>
              <span style={{ textAlign: 'right' }}>输入</span>
              <span style={{ textAlign: 'right' }}>输出</span>
              <span style={{ textAlign: 'right' }}>合计</span>
              <span style={{ textAlign: 'right' }}>耗时</span>
            </div>
            {run.nodes.map((node) => (
              <div className="rv-cost-row" key={node.id}>
                <span className="rv-cost-name">{node.node_name}</span>
                <span className="rv-cost-type">{node.node_type}</span>
                <span className="rv-cost-model">{node.model || '—'}</span>
                <span className="rv-cost-num">{(node.tokens_in || 0).toLocaleString()}</span>
                <span className="rv-cost-num">{(node.tokens_out || 0).toLocaleString()}</span>
                <span className="rv-cost-num">{nodeTokens(node).toLocaleString()}</span>
                <span className="rv-cost-num">{formatDuration(node.duration_ms)}</span>
              </div>
            ))}
            <div className="rv-cost-row rv-cost-total">
              <span>合计</span>
              <span />
              <span />
              <span className="rv-cost-num">{tokenStats.tokensIn.toLocaleString()}</span>
              <span className="rv-cost-num">{tokenStats.tokensOut.toLocaleString()}</span>
              <span className="rv-cost-num">{run.total_tokens.toLocaleString()}</span>
              <span className="rv-cost-num">{formatDuration(run.duration_ms)}</span>
            </div>
          </div>
        </Card>
      )}

      {tab === 'diagnostics' && (
        <Card padded>
          <SectionHeader
            title="调试诊断"
            description={
              diagnosis
                ? '后端确定性规则分析（不调用模型）：节点根因、证据与处理建议'
                : '失败节点、错误信息与建议处理方式'
            }
            extra={
              <div className="rv-diag-actions">
                {diagnosisLoading ? (
                  <Pill tone="neutral">分析中…</Pill>
                ) : diagnosisCount > 0 ? (
                  <Pill tone="danger">{diagnosisCount} 个待处理问题</Pill>
                ) : (
                  <Pill tone="success">未发现失败节点</Pill>
                )}
                <Button
                  size="small"
                  icon={<Sparkle size={14} />}
                  loading={deepLoading}
                  disabled={run.status === 'running'}
                  onClick={() => void handleDeepAnalysis(Boolean(deepAnalysis))}
                >
                  {deepAnalysis ? '重新分析' : 'AI 深度分析'}
                </Button>
              </div>
            }
          />
          {diagnosisError && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="自动根因分析不可用，已回退本地规则"
              description={diagnosisError}
            />
          )}
          {diagnosisLoading && !diagnosis ? (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : diagnosis ? (
            diagnosis.items.length === 0 ? (
              <EmptyState
                title="本次运行没有可诊断的失败节点"
                description="如果运行结果不符合预期，可以到「节点执行」里逐个查看输入输出。"
                action={<Button onClick={() => setTab('nodes')}>查看节点执行</Button>}
              />
            ) : (
              <div className="rv-diag-list">
                {diagnosis.items.map((item) => (
                  <div
                    className={`rv-diag-item${item.severity === 'warning' ? ' is-warning' : ''}`}
                    key={`${item.node_id || 'run'}-${item.category}`}
                  >
                    <div className="rv-diag-head">
                      <strong>{item.node_type === 'run' ? '运行级问题' : item.node_name}</strong>
                      <Pill tone={item.severity === 'warning' ? 'warning' : 'danger'}>
                        {DIAGNOSIS_CATEGORY_LABEL[item.category] ?? item.category}
                      </Pill>
                      <span className="rv-diag-confidence">
                        置信度 {Math.round(item.confidence * 100)}%
                      </span>
                    </div>
                    <div className="rv-diag-title">{item.title}</div>
                    <div className="rv-diag-suggestion">{item.root_cause}</div>
                    {item.evidence.length > 0 && (
                      <div className="rv-diag-evidence">
                        {item.evidence.map((evidence) => (
                          <div className="rv-diag-ev" key={evidence.label}>
                            <span className="k">{evidence.label}</span>
                            <span className="v">{evidence.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {item.suggestions.length > 0 && (
                      <ul className="rv-diag-advice">
                        {item.suggestions.map((suggestion) => (
                          <li key={suggestion.text}>
                            <span>{suggestion.text}</span>
                            {suggestion.action && (
                              <Button
                                size="small"
                                type="link"
                                onClick={() => handleDiagnosisAction(item, suggestion.action!)}
                              >
                                {DIAGNOSIS_ACTION_LABEL[suggestion.action] ?? '处理'}
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="rv-error-actions">
                      {item.node_id && run.nodes.some((node) => node.node_id === item.node_id) && (
                        <Button
                          size="small"
                          onClick={() => {
                            const node = run.nodes.find(
                              (candidate) => candidate.node_id === item.node_id,
                            );
                            if (node) openNode(node);
                          }}
                        >
                          在编辑器中打开
                        </Button>
                      )}
                      <Button
                        size="small"
                        onClick={() =>
                          copyText(
                            [
                              item.title,
                              item.root_cause,
                              ...item.evidence.map(
                                (evidence) => `${evidence.label}: ${evidence.value}`,
                              ),
                            ].join('\n'),
                            message,
                          )
                        }
                      >
                        复制诊断
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : failedNodes.length === 0 ? (
            <EmptyState
              title="本次运行没有失败节点"
              description="如果运行结果不符合预期，可以到「节点执行」里逐个查看输入输出。"
              action={<Button onClick={() => setTab('nodes')}>查看节点执行</Button>}
            />
          ) : (
            <div className="rv-diag-list">
              {failedNodes.map((node) => {
                const info = classifyRunError(node.error);
                return (
                  <div className="rv-diag-item" key={node.id}>
                    <div className="rv-diag-head">
                      <strong>{node.node_name}</strong>
                      <Pill tone="danger">{info.label}</Pill>
                      <span className="rv-cost-num">{formatDuration(node.duration_ms)}</span>
                    </div>
                    <div className="rv-diag-error">
                      {node.error || '节点执行失败（未提供错误信息）'}
                    </div>
                    <div className="rv-diag-suggestion">{info.suggestion}</div>
                    <div className="rv-error-actions">
                      <Button size="small" onClick={() => openNode(node)}>
                        在编辑器中打开
                      </Button>
                      <Button size="small" onClick={() => copyText(node.error || '', message)}>
                        复制错误
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="rv-trends">
            <div className="rv-trends-head">
              <strong>跨运行趋势</strong>
              <span className="rv-deep-meta">
                近 {trend?.days ?? 30} 天 · 同一工作流 · 空输出率为质量代理指标
              </span>
              <Button
                size="small"
                type="text"
                loading={trendLoading}
                onClick={() => run.workflow_id && void loadTrends(run.workflow_id)}
              >
                刷新
              </Button>
            </div>
            {trendError && (
              <Alert type="warning" showIcon message="跨运行趋势不可用" description={trendError} />
            )}
            {trendLoading && !trend ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin size="small" />
              </div>
            ) : trend ? (
              trend.total_runs === 0 ? (
                <div className="rv-hint">近 30 天还没有该工作流的已完成运行。</div>
              ) : (
                <>
                  <div className="rv-trend-kpis">
                    <div className="rv-trend-kpi">
                      <span>已完成运行</span>
                      <strong>{trend.total_runs}</strong>
                    </div>
                    <div className="rv-trend-kpi">
                      <span>运行成功率</span>
                      <strong>{Math.round(trend.success_rate * 1000) / 10}%</strong>
                    </div>
                    <div className="rv-trend-kpi">
                      <span>空输出率</span>
                      <strong>{Math.round(trend.empty_output_rate * 1000) / 10}%</strong>
                    </div>
                    <div className="rv-trend-kpi">
                      <span>失败运行</span>
                      <strong>{trend.failed_runs}</strong>
                    </div>
                  </div>
                  <EChart option={trendOption} height={220} />
                  <div className="rv-trend-top">
                    <div className="rv-trend-top-head">
                      同类失败 Top {trend.top_failures.length}
                    </div>
                    {trend.top_failures.length === 0 ? (
                      <div className="rv-hint">窗口内没有失败节点。</div>
                    ) : (
                      trend.top_failures.map((item) => (
                        <div className="rv-trend-top-item" key={item.category}>
                          <div className="rv-trend-top-main">
                            <strong>{DIAGNOSIS_CATEGORY_LABEL[item.category] ?? item.title}</strong>
                            <span className="rv-deep-meta">
                              {item.count} 次 · 影响 {item.failed_runs} 次运行 · 最近{' '}
                              {formatDateTime(item.last_seen)}
                              {item.sample_node_name ? ` · ${item.sample_node_name}` : ''}
                            </span>
                          </div>
                          {item.sample_run_id && (
                            <Button
                              size="small"
                              onClick={() => nav(`${wsPrefix}/runs/${item.sample_run_id}`)}
                            >
                              查看最近一次
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )
            ) : null}
          </div>
          {deepError && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: 12 }}
              message="AI 深度分析失败"
              description={deepError}
            />
          )}
          {deepAnalysis && (
            <div className="rv-deep">
              <div className="rv-deep-head">
                <strong>AI 深度分析</strong>
                {deepAnalysis.cached && <Pill tone="neutral">缓存</Pill>}
                <span className="rv-deep-meta">
                  {deepAnalysis.model || '未知模型'} ·{' '}
                  {(deepAnalysis.tokens_in + deepAnalysis.tokens_out).toLocaleString()} tokens ·{' '}
                  {formatDateTime(deepAnalysis.generated_at)}
                </span>
              </div>
              <div className="rv-deep-body">{deepAnalysis.analysis}</div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
