import { Alert, App, Button, Empty, Spin, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { getRun, listRuns, rerunRun } from '../api';
import type { RunDetail as RunDetailType, RunNodeDetail } from '../api';
import { classifyRunError } from '../errors';
import { formatDuration, pretty, statusMeta, triggerLabel } from '../meta';
import { formatClock, formatDateTime } from '@/shared/utils/datetime';
import './RunView.css';

type NodeTab = 'input' | 'output' | 'error';

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

/** 运行详情 v2：输入 / 输出 / 错误 + 失败置顶诊断 + 对比入口（F1）。 */
export default function RunDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { message } = App.useApp();

  const [run, setRun] = useState<RunDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [tabs, setTabs] = useState<Record<string, NodeTab>>({});
  const [rerunning, setRerunning] = useState(false);
  const [comparing, setComparing] = useState(false);
  const currentIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getRun(id);
      setRun(data);
      setLoadError(null);
      const isFirstLoad = currentIdRef.current !== id;
      currentIdRef.current = id;

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
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

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

  const openNode = (node: RunNodeDetail) => {
    if (!run) return;
    nav(`/workflows/${run.workflow_id}?focus=${encodeURIComponent(node.node_id)}`);
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
      nav(`/runs/${next.id}`);
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
      nav(`/runs/compare?ids=${other.id},${run.id}`);
    } catch (err: any) {
      message.error(err?.message || '获取对比运行失败');
    } finally {
      setComparing(false);
    }
  };

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

  if (!run) return <Empty description="运行不存在" />;

  const runMeta = statusMeta(run.status);
  const runError = classifyRunError(run.error);
  const showRunError = Boolean(run.error) && run.status !== 'running';

  return (
    <div className="rv">
      <div className="rv-head">
        <Button type="text" onClick={() => nav('/runs')}>
          ← 返回
        </Button>
        <h1>运行 {run.id}</h1>
        <Tag color={runMeta.color}>{runMeta.label}</Tag>
        <div className="rv-actions">
          <Button onClick={() => nav(`/workflows/${run.workflow_id}`)}>打开工作流</Button>
          <Button onClick={handleExport} disabled={run.nodes.length === 0}>
            导出 JSON
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
        <div className="rv-stat">
          <div className="k">总耗时</div>
          <div className="v">{formatDuration(run.duration_ms)}</div>
        </div>
        <div className="rv-stat">
          <div className="k">节点</div>
          <div className="v">
            {counts.success ?? 0} 成功 · {counts.failed ?? 0} 失败 · {counts.skipped ?? 0} 跳过
          </div>
        </div>
        <div className="rv-stat">
          <div className="k">tokens</div>
          <div className="v">{run.total_tokens.toLocaleString()}</div>
        </div>
        <div className="rv-stat">
          <div className="k">触发方式</div>
          <div className="v">{triggerLabel(run.trigger)}</div>
        </div>
        <div className="rv-stat">
          <div className="k">开始 → 结束</div>
          <div className="v" style={{ fontSize: 12.5 }}>
            {formatClock(run.started_at)} → {formatClock(run.finished_at)}
          </div>
        </div>
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
              <span style={{ color: '#6b706a' }}>{runError.suggestion}</span>
            </span>
          }
        />
      )}

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
                const tab = tabs[node.node_id] ?? 'output';
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
                      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                        {meta.label}
                      </Tag>
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
                            className={`rv-tab${tab === 'input' ? ' on' : ''}`}
                            disabled={!hasInput}
                            onClick={() =>
                              setTabs((prev) => ({ ...prev, [node.node_id]: 'input' }))
                            }
                          >
                            输入
                          </button>
                          <button
                            type="button"
                            className={`rv-tab${tab === 'output' ? ' on' : ''}`}
                            disabled={!hasOutput}
                            onClick={() =>
                              setTabs((prev) => ({ ...prev, [node.node_id]: 'output' }))
                            }
                          >
                            输出
                          </button>
                          <button
                            type="button"
                            className={`rv-tab${tab === 'error' ? ' on' : ''}`}
                            disabled={!hasError}
                            onClick={() =>
                              setTabs((prev) => ({ ...prev, [node.node_id]: 'error' }))
                            }
                          >
                            错误
                          </button>
                        </div>

                        {tab === 'error' && (
                          <div className="rv-error">
                            <div className="rv-error-title">
                              <Tag color="red" style={{ marginInlineEnd: 0 }}>
                                {nodeError.label}
                              </Tag>
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
                                <Button size="small" onClick={() => nav('/models')}>
                                  去模型配置
                                </Button>
                              )}
                            </div>
                          </div>
                        )}

                        {tab === 'input' && (
                          <>
                            <div className="rv-hint">
                              工作流输入 + 直接上游输出（变量解析前的原始值）
                            </div>
                            <pre className="rv-code">{pretty(node.input)}</pre>
                          </>
                        )}

                        {tab === 'output' && (
                          <>
                            {node.output === null || node.output === undefined ? (
                              <div className="rv-hint">这个节点没有输出（失败 / 跳过 / 取消）</div>
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
                                  pretty(tab === 'input' ? node.input : node.output),
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
              <Button size="small" onClick={() => nav(`/workflows/${run.workflow_id}`)}>
                打开工作流
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
