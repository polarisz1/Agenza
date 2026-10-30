import { describe, expect, it } from 'vitest';

import { canConnect, deserializeGraph, serializeGraph, type EditorNode } from './types';

/**
 * 图序列化与端口矩阵（含条件分支的 from_port 往返）。
 */

const conditionNode: EditorNode = {
  id: 'c',
  type: 'condition',
  position: { x: 0, y: 0 },
  data: { type: 'condition', label: '判断', config: { left: 'a', op: 'eq', right: 'a' } },
};

const outputNode: EditorNode = {
  id: 'out',
  type: 'output',
  position: { x: 200, y: 0 },
  data: { type: 'output', label: '输出', config: { field: 'result' } },
};

describe('serializeGraph', () => {
  it('把 sourceHandle 的分支写成 from_port，普通边为 null', () => {
    const graph = serializeGraph([conditionNode, outputNode], [
      { id: 'e1', source: 'c', target: 'out', sourceHandle: 'true' },
      { id: 'e2', source: 'c', target: 'out' },
    ] as never);

    expect(graph.edges?.[0].from_port).toBe('true');
    expect(graph.edges?.[1].from_port).toBeNull();
  });

  it('节点位置取整并保留 config', () => {
    const node: EditorNode = {
      id: 'l',
      type: 'llm',
      position: { x: 10.6, y: 20.2 },
      data: { type: 'llm', label: 'LLM1', config: { prompt: 'hi' } },
    };

    const graph = serializeGraph([node], []);

    expect(graph.nodes?.[0].position).toEqual({ x: 11, y: 20 });
    expect((graph.nodes?.[0] as { config: { prompt: string } }).config.prompt).toBe('hi');
  });

  it('http 节点的 headers 从文本框 JSON 解析成对象', () => {
    const node: EditorNode = {
      id: 'h',
      type: 'http',
      position: { x: 0, y: 0 },
      data: {
        type: 'http',
        label: 'HTTP1',
        config: { url: 'https://example.com', headers: '{"X-A":"1"}' },
      },
    };

    const graph = serializeGraph([node], []);

    expect((graph.nodes?.[0] as { config: { headers: unknown } }).config.headers).toEqual({
      'X-A': '1',
    });
  });
});

describe('deserializeGraph', () => {
  it('还原 from_port 为 sourceHandle 并带上分支标签', () => {
    const { edges } = deserializeGraph({
      nodes: [],
      edges: [
        { id: 'e1', source: 'c', target: 'out', from_port: 'false' },
        { id: 'e2', source: 'c', target: 'out' },
      ],
    });

    expect(edges[0].sourceHandle).toBe('false');
    expect(edges[0].label).toBe('假');
    expect(edges[1].sourceHandle).toBeUndefined();
  });

  it('缺失的位置与配置回落到默认值', () => {
    const { nodes } = deserializeGraph({ nodes: [{ id: 'x', type: 'python' }] });

    expect(nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(nodes[0].data.label).toBe('Python 脚本');
  });
});

describe('canConnect', () => {
  it('条件节点是控制流，可连任何有输入的节点', () => {
    expect(canConnect('condition', 'extract')).toBe(true);
    expect(canConnect('condition', 'output')).toBe(true);
  });

  it('没有输出端口的节点不能作为起点', () => {
    expect(canConnect('output', 'llm')).toBe(false);
  });
});
