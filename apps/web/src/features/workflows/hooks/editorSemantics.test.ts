import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from './useEditorStore';
import { deserializeGraph, nextLabel, serializeGraph } from '../types';

/**
 * T10-b：命名唯一（F8）、未知类型不降级（F7）、撤销点按"真的改动"压入（F9）。
 */

function reset() {
  useEditorStore.setState({
    workflowId: 'wf_test',
    name: '测试',
    status: 'draft',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedId: null,
    dirty: false,
    saveState: 'idle',
    saveError: null,
    lastSavedAt: null,
    loaded: true,
    rev: 0,
    historyVersion: 0,
    historyAnchor: null,
    past: [],
    future: [],
  });
}

describe('nextLabel', () => {
  it('没有同类节点时从 1 开始', () => {
    expect(nextLabel('llm', [])).toBe('LLM1');
  });

  it('取已有编号的最大值 +1，不因删除而重名（F8）', () => {
    expect(nextLabel('llm', ['LLM1', 'LLM3'])).toBe('LLM4');
    expect(nextLabel('python', ['脚本2', '其他节点'])).toBe('脚本3');
  });

  it('忽略名字里带数字但格式不符的标签', () => {
    expect(nextLabel('llm', ['LLM1 副本', 'LLMx', 'LLM2'])).toBe('LLM3');
  });
});

describe('addNode', () => {
  beforeEach(reset);

  it('连续添加同名类型会拿到递增且唯一的名称', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    store.addNode('llm', { x: 10, y: 0 });

    const labels = useEditorStore.getState().nodes.map((n) => n.data.label);
    expect(labels).toEqual(['LLM1', 'LLM2']);
    expect(new Set(labels).size).toBe(2);
  });

  it('删掉中间节点后再添加，不会与现存节点重名', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    store.addNode('llm', { x: 10, y: 0 });
    store.addNode('llm', { x: 20, y: 0 });
    const second = useEditorStore.getState().nodes[1];
    useEditorStore.getState().onNodesChange([{ id: second.id, type: 'remove' }]);

    useEditorStore.getState().addNode('llm', { x: 30, y: 0 });

    const labels = useEditorStore.getState().nodes.map((n) => n.data.label);
    expect(labels).toEqual(['LLM1', 'LLM3', 'LLM4']);
  });
});

describe('未知节点类型（F7）', () => {
  it('不降级成 python，而是标成 unknown 并保留原始 type', () => {
    const { nodes } = deserializeGraph({
      nodes: [{ id: 'x', type: 'rag', name: '检索', position: { x: 0, y: 0 }, config: { q: 1 } }],
      edges: [],
    });

    expect(nodes[0].type).toBe('unknown');
    expect(nodes[0].data.unknownType).toBe('rag');
    expect(nodes[0].data.config).toEqual({ q: 1 });
  });

  it('保存时把原始 type 原样写回，数据不被改写', () => {
    const { nodes } = deserializeGraph({
      nodes: [{ id: 'x', type: 'rag', name: '检索', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });

    const graph = serializeGraph(nodes, []);

    expect((graph.nodes?.[0] as { type: string }).type).toBe('rag');
  });
});

describe('撤销点（F9）', () => {
  beforeEach(reset);

  it('同一节点连续编辑只压一次撤销栈', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    const id = useEditorStore.getState().nodes[0].id;
    const afterAdd = useEditorStore.getState().past.length;

    store.updateNodeConfig(id, { prompt: 'a' });
    store.updateNodeConfig(id, { prompt: 'ab' });
    store.updateNodeConfig(id, { prompt: 'abc' });

    expect(useEditorStore.getState().past.length).toBe(afterAdd + 1);
  });

  it('换到另一个节点编辑会压入新的撤销点', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    store.addNode('llm', { x: 10, y: 0 });
    const [first, second] = useEditorStore.getState().nodes;
    const base = useEditorStore.getState().past.length;

    store.select(first.id);
    store.updateNodeConfig(first.id, { prompt: 'a' });
    store.select(second.id);
    store.updateNodeConfig(second.id, { prompt: 'b' });

    expect(useEditorStore.getState().past.length).toBe(base + 2);
  });

  it('值没变时不压栈', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    const id = useEditorStore.getState().nodes[0].id;
    const base = useEditorStore.getState().past.length;

    store.updateNodeConfig(id, { prompt: '' }); // 与默认值一致

    expect(useEditorStore.getState().past.length).toBe(base);
  });
});
