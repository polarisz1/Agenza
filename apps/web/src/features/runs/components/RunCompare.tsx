import { Alert, App, Button, Empty, Spin, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { compareRuns } from '../api';
import type { CompareNode, RunDetail, RunCompareResult } from '../api';
import { diffLines } from '../diff';
import { formatDuration, pretty, statusMeta } from '../meta';
import './RunView.css';

function runSummary(run: RunDetail) {
  const meta = statusMeta(run.status);
  return (
    <span className="rv-compare-cell">
      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
        {meta.label}
      </Tag>
      <span className="dim">{formatDuration(run.duration_ms)}</span>
      <span className="dim">· {run.total_tokens} tok</span>
    </span>
  );
}

function nodeCell(node: CompareNode['a'], other: CompareNode['a']) {
  if (!node) return <span className="dim">仅另一侧有</span>;
  const meta = statusMeta(node.status);
  const delta =
    node.duration_ms != null && other?.duration_ms != null
      ? node.duration_ms - other.duration_ms
      : null;

  return (
    <span className="rv-compare-cell">
      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
        {meta.label}
      </Tag>
      <span className="dim">{formatDuration(node.duration_ms)}</span>
      {node.tokens_in || node.tokens_out ? (
        <span className="dim">
          · {node.tokens_in}→{node.tokens_out} tok
        </span>
      ) : null}
      {node.error && (
        <span className="dim" style={{ color: '#b03a3a' }}>
          · {node.error.slice(0, 60)}
        </span>
      )}
      {delta !== null && delta !== 0 && (
        <span className={`rv-delta ${delta > 0 ? 'up' : 'down'}`}>
          {delta > 0 ? '+' : ''}
          {delta}ms
        </span>
      )}
    </span>
  );
}

/** 运行对比：后端按 node_id 对齐，前端做并排展示与行级输出 diff（F1）。 */
export default function RunCompare() {
  const nav = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const ids = useMemo(
    () =>
      (params.get('ids') || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    [params],
  );

  const [data, setData] = useState<RunCompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (ids.length !== 2) return;
    setLoading(true);
    setError(null);
    try {
      const result = await compareRuns(ids[0], ids[1]);
      setData(result);
      const firstDiff = result.nodes.find((node) => {
        const a = node.a;
        const b = node.b;
        return JSON.stringify(a?.output ?? null) !== JSON.stringify(b?.output ?? null);
      });
      setSelected(firstDiff?.node_id ?? result.nodes[0]?.node_id ?? null);
    } catch (err: any) {
      setError(err?.message || '加载对比失败');
    } finally {
      setLoading(false);
    }
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

  if (ids.length !== 2) {
    return (
      <Empty description="请先在运行列表勾选两条运行，再点「对比选中」">
        <Button type="primary" onClick={() => nav(`${wsPrefix}/runs`)}>
          去运行记录
        </Button>
      </Empty>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载对比失败"
        description={error || '未知错误'}
        action={
          <Button size="small" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  }

  const selectedNode = data.nodes.find((node) => node.node_id === selected) ?? null;
  const diffCount = data.nodes.filter(
    (node) =>
      node.a?.status !== node.b?.status ||
      JSON.stringify(node.a?.output ?? null) !== JSON.stringify(node.b?.output ?? null),
  ).length;

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `run-compare-${data.a.id}-${data.b.id}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const renderDiff = () => {
    if (!selectedNode) return <div className="rv-diff-empty">选择上方任意节点查看输出差异</div>;
    const aText = selectedNode.a?.output === undefined ? '' : pretty(selectedNode.a?.output);
    const bText = selectedNode.b?.output === undefined ? '' : pretty(selectedNode.b?.output);
    if (aText === bText) {
      return <div className="rv-diff-empty">这个节点的输出两侧一致：{aText || '（无输出）'}</div>;
    }
    const lines = diffLines(aText, bText);
    return (
      <div className="rv-diff-body">
        {lines.map((line, index) => (
          <div className={`rv-diff-line ${line.type}`} key={`${line.type}-${index}`}>
            {line.type === 'rem' ? '- ' : line.type === 'add' ? '+ ' : '  '}
            {line.text}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="rv">
      <div className="rv-head">
        <Button type="text" onClick={() => nav(`${wsPrefix}/runs`)}>
          ← 返回
        </Button>
        <h1>对比运行</h1>
        <span className="dim">
          {data.a.id}（A） vs {data.b.id}（B）
        </span>
        <div className="rv-actions">
          <Button
            onClick={() => {
              nav(`${wsPrefix}/runs/compare?ids=${data.b.id},${data.a.id}`);
              message.info('已交换 A/B');
            }}
          >
            交换 A/B
          </Button>
          <Button onClick={handleExport}>导出对比</Button>
        </div>
      </div>

      <div className="rv-stats">
        <div className="rv-stat">
          <div className="k">A · {data.a.workflow_name}</div>
          <div className="v" style={{ fontSize: 13 }}>
            {runSummary(data.a)}
          </div>
        </div>
        <div className="rv-stat">
          <div className="k">B · {data.b.workflow_name}</div>
          <div className="v" style={{ fontSize: 13 }}>
            {runSummary(data.b)}
          </div>
        </div>
        <div className="rv-stat">
          <div className="k">有差异的节点</div>
          <div className="v">{diffCount} 个</div>
        </div>
      </div>

      <div className="rv-compare">
        <div className="rv-compare-head">
          <div>节点</div>
          <div>A · {data.a.id}</div>
          <div>B · {data.b.id}</div>
        </div>
        {data.nodes.map((node) => (
          <div
            className={`rv-compare-row${selected === node.node_id ? ' on' : ''}`}
            key={node.node_id}
            onClick={() => setSelected(node.node_id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelected(node.node_id);
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{node.node_name}</div>
              <div className="dim" style={{ fontSize: 11 }}>
                {node.node_type}
              </div>
            </div>
            <div>{nodeCell(node.a, node.b)}</div>
            <div>{nodeCell(node.b, node.a)}</div>
          </div>
        ))}
      </div>

      <div className="rv-diff">
        <div className="rv-diff-head">输出差异 · {selectedNode?.node_name ?? '—'}</div>
        {renderDiff()}
      </div>
    </div>
  );
}
