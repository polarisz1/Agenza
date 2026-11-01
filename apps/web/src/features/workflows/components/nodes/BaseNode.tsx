import { memo } from 'react';
import type { ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  ApiOutlined,
  BranchesOutlined,
  CodeOutlined,
  ExportOutlined,
  ImportOutlined,
  MergeCellsOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  TableOutlined,
} from '@ant-design/icons';

import {
  NODE_META,
  STATUS_TEXT,
  nodeDetail,
  nodeSummary,
  type EditorNode,
  type EditorNodeType,
} from '../../types';
import './nodes.css';

const TYPE_ICON: Record<EditorNodeType, ReactNode> = {
  unknown: <QuestionCircleOutlined />,
  input: <ImportOutlined />,
  llm: <RobotOutlined />,
  extract: <TableOutlined />,
  http: <ApiOutlined />,
  python: <CodeOutlined />,
  condition: <BranchesOutlined />,
  merge: <MergeCellsOutlined />,
  output: <ExportOutlined />,
};

function formatDuration(ms?: number): string {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 节点卡 v2（F2/T5.2.4）：
 * 类型图标 + 名称 + 状态；主/次两行摘要；运行后显示耗时/token；失败显示错误首行。
 * 8 类节点共用骨架，但主/次摘要由 type 决定（见 types.ts::nodeSummary/nodeDetail）。
 */
function BaseNode({ data, selected }: NodeProps<EditorNode>) {
  const meta = NODE_META[data.type];
  const status = data.runtimeStatus;
  const summary = nodeSummary(data);
  const detail = nodeDetail(data);
  const duration = formatDuration(data.runtimeDurationMs);
  const tokens = data.runtimeTokens ?? 0;
  const error = data.runtimeError ?? '';

  return (
    <div
      className={[
        'afn',
        selected ? 'afn--selected' : '',
        data.hasIssue ? 'afn--issue' : '',
        status === 'failed' ? 'afn--failed' : '',
        status === 'running' ? 'afn--running' : '',
        status === 'skipped' || status === 'cancelled' ? 'afn--muted' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {meta.hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="afn-handle"
          role="button"
          aria-label={`${data.label} 输入端口`}
          title="输入端口"
        />
      )}

      <div className="afn-head">
        <span className="afn-ico" style={{ background: meta.color }} aria-hidden>
          {TYPE_ICON[data.type]}
        </span>
        <span className="afn-title" title={data.label}>
          {data.label}
        </span>
        {status && (
          <span className={`afn-status afn-status--${status}`}>{STATUS_TEXT[status]}</span>
        )}
        {data.hasIssue && !status && <span className="afn-issue-dot" title="校验有问题" />}
      </div>

      <div className="afn-main" title={summary}>
        {summary}
      </div>
      {detail && (
        <div className="afn-sub" title={detail}>
          {detail}
        </div>
      )}

      {status === 'failed' && error && (
        <div className="afn-err" title={error}>
          {error}
        </div>
      )}

      {(duration || tokens > 0) && status && status !== 'running' && status !== 'queued' && (
        <div className="afn-foot">
          {duration && <span>{duration}</span>}
          {tokens > 0 && <span>{tokens} tok</span>}
        </div>
      )}

      {data.type === 'condition' ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            className="afn-handle afn-handle--true"
            style={{ top: '35%' }}
            role="button"
            aria-label={`${data.label} 真分支输出端口`}
            title="条件为真时走这支"
          />
          <span className="afn-branch afn-branch--true" style={{ top: '35%' }}>
            真
          </span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            className="afn-handle afn-handle--false"
            style={{ top: '72%' }}
            role="button"
            aria-label={`${data.label} 假分支输出端口`}
            title="条件为假时走这支"
          />
          <span className="afn-branch afn-branch--false" style={{ top: '72%' }}>
            假
          </span>
        </>
      ) : (
        meta.hasOutput && (
          <Handle
            type="source"
            position={Position.Right}
            className="afn-handle"
            role="button"
            aria-label={`${data.label} 输出端口`}
            title="输出端口"
          />
        )
      )}
    </div>
  );
}

export default memo(BaseNode);
