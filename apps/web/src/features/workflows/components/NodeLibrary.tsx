import { useMemo, useState } from 'react';

import { NODE_DRAG_MIME, NODE_GROUPS, NODE_META, type NodeType } from '../types';

interface Props {
  onAdd: (type: NodeType) => void;
}

/** 左侧节点库：按分组展示，支持搜索、点击添加与拖拽入画布 */
export default function NodeLibrary({ onAdd }: Props) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const all = Object.keys(NODE_META) as NodeType[];
    return NODE_GROUPS.map((group) => ({
      group,
      items: all
        .filter((type) => NODE_META[type].group === group)
        .filter((type) => {
          if (!query.trim()) return true;
          const meta = NODE_META[type];
          return meta.label.includes(query.trim()) || meta.desc.includes(query.trim());
        }),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <aside className="afe-nodes">
      <div className="afe-panel-label">节点库</div>
      <div className="afe-nodes-search">
        <input
          className="afe-input"
          placeholder="搜索节点..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {groups.length === 0 && <div className="afe-nodes-empty">没有匹配的节点</div>}

      {groups.map(({ group, items }) => (
        <div className="afe-node-group" key={group}>
          <div className="afe-node-group-title">{group}</div>
          {items.map((type) => {
            const meta = NODE_META[type];
            return (
              <div
                className="afe-lib-item"
                key={type}
                draggable
                title="拖拽到画布，或点击添加"
                onDragStart={(e) => {
                  e.dataTransfer.setData(NODE_DRAG_MIME, type);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => onAdd(type)}
              >
                <span className="afe-lib-bar" style={{ background: meta.color }} />
                <div>
                  <div className="afe-lib-name">{meta.label}</div>
                  <div className="afe-lib-desc">{meta.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
