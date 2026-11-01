import { Empty, Input, Modal } from 'antd';
import type { InputRef } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';

import { NODE_META, nodeDetail, type EditorNode } from '../types';

export interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  mode: 'command' | 'node';
  nodes: EditorNode[];
  commands: CommandItem[];
  onClose: () => void;
  onPickNode: (nodeId: string) => void;
}

/**
 * 命令面板 / 节点搜索（F2/T5.2.6）。
 * Ctrl+K 打开命令面板；Ctrl+F 打开节点搜索；↑↓ 选择、Enter 执行、Esc 关闭。
 */
export default function CommandPalette({
  open,
  mode,
  nodes,
  commands,
  onClose,
  onPickNode,
}: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open, mode]);

  const items = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (mode === 'node') {
      return nodes
        .filter((node) => {
          if (!keyword) return true;
          const meta = NODE_META[node.data.type];
          return (
            node.data.label.toLowerCase().includes(keyword) ||
            meta.label.toLowerCase().includes(keyword) ||
            nodeDetail(node.data).toLowerCase().includes(keyword)
          );
        })
        .map((node) => ({
          key: node.id,
          label: node.data.label,
          hint: `${NODE_META[node.data.type].label}${nodeDetail(node.data) ? ` · ${nodeDetail(node.data)}` : ''}`,
          run: () => onPickNode(node.id),
        }));
    }

    return commands
      .filter(
        (command) =>
          !keyword ||
          command.label.toLowerCase().includes(keyword) ||
          (command.hint || '').toLowerCase().includes(keyword),
      )
      .map((command) => ({
        key: command.id,
        label: command.label,
        hint: command.hint || '',
        run: command.run,
      }));
  }, [mode, nodes, commands, query, onPickNode]);

  useEffect(() => {
    setActive((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

  const execute = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <Modal
      open={open}
      footer={null}
      closable={false}
      width={560}
      onCancel={onClose}
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
      className="afe-palette-modal"
    >
      <div className="afe-palette">
        <div className="afe-palette-head">
          <Input
            ref={inputRef}
            bordered={false}
            placeholder={mode === 'node' ? '搜索节点名称 / 类型…' : '输入命令…'}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((prev) => Math.min(prev + 1, items.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((prev) => Math.max(prev - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                execute(active);
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
          />
          <span className="afe-palette-kbd">Esc</span>
        </div>
        <div className="afe-palette-list">
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配项" />
          ) : (
            items.map((item, index) => (
              <button
                type="button"
                key={item.key}
                className={`afe-palette-item${index === active ? ' on' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => execute(index)}
              >
                <span className="afe-palette-label">{item.label}</span>
                {item.hint && <span className="afe-palette-hint">{item.hint}</span>}
              </button>
            ))
          )}
        </div>
        <div className="afe-palette-foot">
          ↑↓ 选择 · Enter 执行 · Esc 关闭
          <span style={{ marginLeft: 'auto' }}>{mode === 'node' ? '节点搜索' : '命令面板'}</span>
        </div>
      </div>
    </Modal>
  );
}
