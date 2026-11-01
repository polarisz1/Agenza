import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from './useEditorStore';
import {
  connectionIssue,
  countIncoming,
  deserializeGraph,
  hasPath,
  nextLabel,
  serializeGraph,
} from '../types';

/**
 * T10-b：命名唯一（F8）、未知类型不降级（F7）、撤销点按"真的改动"压入（F9）。
 */

function reset() {
  useEditorStore.setState({
    workflowId: 'wf_test',
    name: '测试',
    description: '',
    status: 'draft',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedId: null,
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

describe('连线校验（G21）', () => {
  const GRAPH = {
    version: 1,
    inputs: [],
    nodes: [
      { id: 'in', type: 'input', name: '输入1', position: { x: 0, y: 0 }, config: { key: 'q' } },
      { id: 'a', type: 'llm', name: 'LLM1', position: { x: 200, y: 0 }, config: {} },
      { id: 'b', type: 'llm', name: 'LLM2', position: { x: 400, y: 0 }, config: {} },
      { id: 'c', type: 'llm', name: 'LLM3', position: { x: 600, y: 0 }, config: {} },
      { id: 'm', type: 'merge', name: '合并1', position: { x: 400, y: 120 }, config: {} },
      { id: 'cond', type: 'condition', name: '条件1', position: { x: 200, y: 240 }, config: {} },
      { id: 'out', type: 'output', name: '输出1', position: { x: 800, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'e1', source: 'in', target: 'a' },
      { id: 'e2', source: 'a', target: 'b' },
      { id: 'e3', source: 'b', target: 'c' },
    ],
  };

  function setup() {
    return deserializeGraph(GRAPH);
  }

  it('hasPath 能识别传递可达关系', () => {
    const { edges } = setup();
    expect(hasPath(edges, 'in', 'c')).toBe(true);
    expect(hasPath(edges, 'c', 'in')).toBe(false);
  });

  it('countIncoming 只数目标节点的入边', () => {
    const { edges } = setup();
    expect(countIncoming(edges, 'a')).toBe(1);
    expect(countIncoming(edges, 'm')).toBe(0);
  });

  it('拒绝会形成环路的连线', () => {
    // 单独造一条 a→b→c 的链：目标 a 的入度为 0，这样才会走到环检测（而不是先被入度拦下）
    const { nodes, edges } = deserializeGraph({
      version: 1,
      inputs: [],
      nodes: ['a', 'b', 'c'].map((id, index) => ({
        id,
        type: 'llm',
        name: `LLM${index + 1}`,
        position: { x: index * 200, y: 0 },
        config: {},
      })),
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'c' },
      ],
    });

    const issue = connectionIssue(nodes, edges, { source: 'c', target: 'a' });
    expect(issue).toContain('环路');
  });

  it('拒绝向单输入节点灌第二条上游', () => {
    const { nodes, edges } = setup();
    const issue = connectionIssue(nodes, edges, { source: 'b', target: 'a' });
    expect(issue).toContain('只接受一个输入');
  });

  it('merge 节点允许多路汇聚', () => {
    const { nodes, edges } = setup();
    const withOne = [...edges, { id: 'm1', source: 'a', target: 'm' }];
    expect(connectionIssue(nodes, withOne, { source: 'b', target: 'm' })).toBeNull();
  });

  it('条件节点必须从「真 / 假」端口出线', () => {
    const { nodes, edges } = setup();
    expect(connectionIssue(nodes, edges, { source: 'cond', target: 'm' })).toContain('真');
    expect(
      connectionIssue(nodes, edges, { source: 'cond', target: 'm', sourceHandle: 'true' }),
    ).toBeNull();
    expect(
      connectionIssue(nodes, edges, { source: 'cond', target: 'm', sourceHandle: 'false' }),
    ).toBeNull();
  });

  it('拒绝连到没有输入端口的节点、拒绝类型不匹配', () => {
    const { nodes, edges } = setup();
    expect(connectionIssue(nodes, edges, { source: 'out', target: 'in' })).toContain(
      '没有输入端口',
    );
    expect(connectionIssue(nodes, edges, { source: 'out', target: 'm' })).toContain('类型不匹配');
  });

  it('store.onConnect 会真的拒绝非法连线', () => {
    reset();
    const { nodes, edges } = setup();
    useEditorStore.setState({ nodes, edges, selectedId: null });

    useEditorStore
      .getState()
      .onConnect({ source: 'b', target: 'a', sourceHandle: null, targetHandle: null });

    // 入度超限：边数不变、也没有多压一个撤销点
    expect(useEditorStore.getState().edges).toHaveLength(3);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});

describe('撤销还原选中态（G20）', () => {
  beforeEach(reset);

  it('undo 恢复到快照里的 selectedId，而不是"id 还在就保留"', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    store.addNode('llm', { x: 10, y: 0 });
    const [first, second] = useEditorStore.getState().nodes;

    useEditorStore.getState().select(second.id);
    useEditorStore.getState().beginHistory(); // 快照：选中 second

    useEditorStore.getState().select(first.id);
    expect(useEditorStore.getState().selectedId).toBe(first.id);

    useEditorStore.getState().undo();

    const after = useEditorStore.getState();
    expect(after.selectedId).toBe(second.id);
    expect(after.nodes.find((n) => n.id === second.id)?.selected).toBe(true);
    expect(after.nodes.find((n) => n.id === first.id)?.selected).toBe(false);
  });

  it('redo 也会还原选中态', () => {
    const store = useEditorStore.getState();
    store.addNode('llm', { x: 0, y: 0 });
    const id = useEditorStore.getState().nodes[0].id;

    store.select(id);
    store.beginHistory();
    store.select(null);
    store.undo();
    store.redo();

    expect(useEditorStore.getState().selectedId).toBeNull();
  });
});
