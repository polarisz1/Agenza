import { beforeEach, describe, expect, it } from 'vitest';

import { clearEditorClipboardForTests, useEditorStore } from './useEditorStore';
import type { EditorNode } from '../types';

/**
 * F2：多选、批量、复制/粘贴/副本（T5.2.1–T5.2.2）。
 * 纯 store 逻辑，不需要浏览器。
 */

function node(id: string, label: string, x: number): EditorNode {
  return {
    id,
    type: 'llm',
    position: { x, y: 0 },
    data: { type: 'llm', label, config: { prompt: '' } },
  };
}

function reset() {
  useEditorStore.setState({
    workflowId: 'wf_multi',
    name: '多选测试',
    description: '',
    status: 'draft',
    nodes: [node('a', 'LLM1', 0), node('b', 'LLM2', 200), node('c', 'LLM3', 400)],
    edges: [
      { id: 'e_ab', source: 'a', target: 'b' },
      { id: 'e_bc', source: 'b', target: 'c' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedId: null,
    selectedIds: [],
    dirty: false,
    saveState: 'idle',
    saveError: null,
    lastSavedAt: null,
    rev: 0,
    historyVersion: 0,
    historyAnchor: null,
    past: [],
    future: [],
  });
  clearEditorClipboardForTests();
}

describe('多选（T5.2.1）', () => {
  beforeEach(reset);

  it('setSelection 同步 selectedIds 与节点 selected 标记；多选时 selectedId 为空', () => {
    useEditorStore.getState().setSelection(['a', 'c']);

    const state = useEditorStore.getState();
    expect(state.selectedIds).toEqual(['a', 'c']);
    expect(state.selectedId).toBeNull();
    expect(state.nodes.filter((n) => n.selected).map((n) => n.id)).toEqual(['a', 'c']);
  });

  it('单选时 selectedId 有值，供属性面板使用', () => {
    useEditorStore.getState().setSelection(['b']);

    expect(useEditorStore.getState().selectedId).toBe('b');
  });

  it('批量删除：节点与相关连线一起删除，只压一个撤销点，可撤销恢复', () => {
    useEditorStore.getState().setSelection(['a', 'b']);
    const historyBefore = useEditorStore.getState().past.length;

    useEditorStore.getState().deleteSelected();

    let state = useEditorStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(['c']);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedIds).toEqual([]);
    expect(state.selectedId).toBeNull();
    expect(state.past.length).toBe(historyBefore + 1);

    useEditorStore.getState().undo();
    state = useEditorStore.getState();
    expect(state.nodes).toHaveLength(3);
    expect(state.edges).toHaveLength(2);
    expect(state.selectedIds).toEqual(['a', 'b']);
  });

  it('批量启用/禁用是幂等切换，且一次撤销点', () => {
    useEditorStore.getState().setSelection(['a', 'b']);
    const history = useEditorStore.getState().past.length;

    useEditorStore.getState().toggleSelectedEnabled();
    let state = useEditorStore.getState();
    expect(state.nodes.filter((n) => n.data.config.enabled === false).map((n) => n.id)).toEqual([
      'a',
      'b',
    ]);
    expect(state.past.length).toBe(history + 1);

    useEditorStore.getState().toggleSelectedEnabled();
    state = useEditorStore.getState();
    expect(state.nodes.every((n) => n.data.config.enabled !== false)).toBe(true);
  });
});

describe('复制 / 粘贴 / 副本（T5.2.2）', () => {
  beforeEach(reset);

  it('复制粘贴：新 id、名称唯一、保留内部连线、位置偏移、新节点被选中', () => {
    const store = useEditorStore.getState();
    store.setSelection(['a', 'b']);
    store.copySelection();
    store.pasteClipboard();

    const state = useEditorStore.getState();
    expect(state.nodes).toHaveLength(5);
    const originals = new Set(['a', 'b', 'c']);
    const copies = state.nodes.filter((n) => !originals.has(n.id));
    expect(copies).toHaveLength(2);
    expect(new Set(state.nodes.map((n) => n.data.label)).size).toBe(5);
    expect(copies.map((n) => n.data.label)).toEqual(['LLM4', 'LLM5']);
    expect(copies.map((n) => n.position.x)).toEqual([24, 224]);
    expect(state.selectedIds).toEqual(copies.map((n) => n.id));

    // a→b 被复制；b→c 只有一端在选区内，不复制
    expect(state.edges).toHaveLength(3);
    const copiedEdge = state.edges.find((edge) => !originals.has(edge.source));
    expect(copiedEdge).toBeTruthy();
    expect(copiedEdge?.source).not.toBe('a');
    expect(copiedEdge?.target).not.toBe('b');
  });

  it('副本（Ctrl+D）= 复制 + 粘贴，一次撤销点', () => {
    useEditorStore.getState().setSelection(['c']);
    const history = useEditorStore.getState().past.length;

    useEditorStore.getState().duplicateSelection();

    const state = useEditorStore.getState();
    expect(state.nodes).toHaveLength(4);
    expect(state.past.length).toBe(history + 1);
    expect(state.nodes.at(-1)?.data.label).toBe('LLM4');
  });

  it('没有复制内容时粘贴是空操作', () => {
    const before = useEditorStore.getState();
    useEditorStore.getState().pasteClipboard();
    const after = useEditorStore.getState();

    expect(after.nodes).toBe(before.nodes);
    expect(after.edges).toBe(before.edges);
  });

  it('未选中节点时复制是空操作', () => {
    useEditorStore.getState().copySelection();
    useEditorStore.getState().pasteClipboard();

    expect(useEditorStore.getState().nodes).toHaveLength(3);
  });
});
