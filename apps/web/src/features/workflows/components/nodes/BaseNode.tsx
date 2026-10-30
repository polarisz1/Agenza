import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { NODE_META, STATUS_TEXT, nodeSummary, type EditorNode } from '../../types';
import './nodes.css';

/** 所有节点共用的卡片骨架：标题 / 摘要 / 状态徽标 / 左右端口 */
function BaseNode({ data, selected }: NodeProps<EditorNode>) {
  const meta = NODE_META[data.type];
  const status = data.runtimeStatus;

  return (
    <div
      className={[
        'afn',
        selected ? 'afn--selected' : '',
        data.hasIssue ? 'afn--issue' : '',
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
        <span className="afn-bar" style={{ background: meta.color }} />
        <span className="afn-title" title={data.label}>
          {data.label}
        </span>
        {status && (
          <span className={`afn-status afn-status--${status}`}>{STATUS_TEXT[status]}</span>
        )}
      </div>

      <div className="afn-body">
        <span className="afn-summary" title={nodeSummary(data)}>
          {nodeSummary(data)}
        </span>
        <span className="afn-kind">{meta.label}</span>
      </div>

      {meta.hasOutput && (
        <Handle
          type="source"
          position={Position.Right}
          className="afn-handle"
          role="button"
          aria-label={`${data.label} 输出端口`}
          title="输出端口"
        />
      )}
    </div>
  );
}

export default memo(BaseNode);
