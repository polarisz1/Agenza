import { Alert, App, Button, Descriptions, Empty, Spin, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { getRun, rerunRun } from '../api';
import type { RunDetail as RunDetailType } from '../api';
import { formatClock, formatDateTime } from '@/shared/utils/datetime';

const statusColor: Record<string, string> = {
  waiting_input: 'blue',
  running: 'processing',
  success: 'green',
  failed: 'red',
  cancelled: 'default',
  skipped: 'default',
};

const statusText: Record<string, string> = {
  waiting_input: '等待输入',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
};

function formatTime(value?: string | null): string {
  return formatDateTime(value);
}

function clock(value?: string | null): string {
  return formatClock(value);
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function RunDetail() {
  const { message } = App.useApp();
  const { id } = useParams();
  const nav = useNavigate();
  const [run, setRun] = useState<RunDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const data = await getRun(id);
    setRun(data);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err: any) => message.error(err?.message || '加载运行详情失败'))
      .finally(() => setLoading(false));
  }, [load, message]);

  // 运行中每 2s 刷新一次，结束后停止
  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = window.setInterval(() => {
      void load();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [run?.status, load]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const node of run?.nodes ?? []) {
      result[node.status] = (result[node.status] ?? 0) + 1;
    }
    return result;
  }, [run?.nodes]);

  const providerIssue = (run?.nodes ?? []).some(
    (node) => node.error && node.error.includes('服务商'),
  );

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

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }
  if (!run) return <Empty description="运行不存在" />;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <Button onClick={() => nav('/runs')}>← 返回</Button>
        <div style={{ fontSize: 18, fontWeight: 600 }}>运行详情 · {run.id}</div>
        <Tag color={statusColor[run.status] || 'default'}>
          {statusText[run.status] || run.status}
        </Tag>
        <Button
          type="primary"
          style={{ marginLeft: 'auto' }}
          loading={rerunning}
          onClick={() => void handleRerun()}
        >
          以此配置重新运行
        </Button>
      </div>

      {run.error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="运行失败"
          description={run.error}
        />
      )}
      {providerIssue && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="存在模型服务商相关错误"
          description={
            <span>
              请检查服务商配置与密钥，<Link to="/models">前往模型配置</Link>。
            </span>
          }
        />
      )}

      <Descriptions
        bordered
        size="small"
        column={3}
        style={{ background: '#fff', borderRadius: 10 }}
      >
        <Descriptions.Item label="工作流">{run.workflow_name}</Descriptions.Item>
        <Descriptions.Item label="触发方式">{run.trigger}</Descriptions.Item>
        <Descriptions.Item label="总耗时">
          {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(2)}s` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="开始时间">{formatTime(run.started_at)}</Descriptions.Item>
        <Descriptions.Item label="结束时间">{formatTime(run.finished_at)}</Descriptions.Item>
        <Descriptions.Item label="Token 总量">
          {run.total_tokens.toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label="节点结果" span={3}>
          成功 {counts.success ?? 0} · 失败 {counts.failed ?? 0} · 跳过 {counts.skipped ?? 0} · 取消{' '}
          {counts.cancelled ?? 0} · 运行中 {counts.running ?? 0}
        </Descriptions.Item>
      </Descriptions>

      <div style={{ marginTop: 20, marginBottom: 8, fontWeight: 600 }}>节点时间线</div>
      <div
        style={{
          background: '#fff',
          borderRadius: 10,
          border: '1px solid #e2e0d8',
          overflow: 'hidden',
        }}
      >
        {run.nodes.length === 0 ? (
          <div style={{ padding: 24, color: '#8b9088' }}>无节点记录</div>
        ) : (
          run.nodes.map((node, index) => (
            <div
              key={node.id}
              style={{
                padding: '12px 16px',
                borderBottom: index === run.nodes.length - 1 ? 'none' : '1px solid #eff0ec',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#edf3ef',
                    color: '#1f4e3d',
                    fontSize: 11,
                  }}
                >
                  {index + 1}
                </span>
                <Tag color={statusColor[node.status] || 'default'}>
                  {statusText[node.status] || node.status}
                </Tag>
                <span style={{ fontWeight: 500 }}>{node.node_name}</span>
                <span style={{ color: '#8b9088', fontSize: 12 }}>{node.node_type}</span>
                <span style={{ color: '#8b9088', fontSize: 12 }}>
                  {clock(node.started_at)} → {clock(node.finished_at)}
                </span>
                <span style={{ marginLeft: 'auto', color: '#8b9088', fontSize: 12 }}>
                  {node.duration_ms}ms
                  {node.model ? ` · ${node.model}` : ''}
                  {node.tokens_in || node.tokens_out
                    ? ` · ${node.tokens_in}→${node.tokens_out} tokens`
                    : ''}
                </span>
              </div>

              {node.error && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: '#fdf2ea',
                    color: '#a86612',
                    fontSize: 12,
                    wordBreak: 'break-all',
                  }}
                >
                  {node.error}
                </div>
              )}

              {node.output !== undefined && node.output !== null && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', color: '#2f7059', fontSize: 12 }}>
                    输出
                  </summary>
                  <pre
                    style={{
                      margin: '6px 0 0',
                      padding: 10,
                      maxHeight: 220,
                      overflow: 'auto',
                      borderRadius: 6,
                      background: '#f4f5f2',
                      fontSize: 11,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {pretty(node.output)}
                  </pre>
                </details>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
