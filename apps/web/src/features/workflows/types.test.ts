import { describe, expect, it } from 'vitest';

import {
  canConnect,
  deserializeGraph,
  nodeDetail,
  nodeSummary,
  serializeGraph,
  type EditorNode,
} from './types';

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

describe('节点卡摘要（v2）', () => {
  function data(type: EditorNode['data']['type'], config: Record<string, unknown>) {
    return { type, label: 'N', config };
  }

  it('LLM：主行模型/温度，次行提示词首行', () => {
    const node = data('llm', {
      model: 'deepseek-chat',
      temperature: 0.3,
      system: '你是摘要助手',
      prompt: '请摘要',
    });
    expect(nodeSummary(node)).toBe('deepseek-chat · T=0.3');
    expect(nodeDetail(node)).toBe('你是摘要助手');
  });

  it('抽取：主行字段数，次行前三个字段名', () => {
    const node = data('extract', {
      fields_text: 'sentiment: 情感\nkeywords：关键词\nsummary: 摘要\nignored',
    });
    expect(nodeSummary(node)).toBe('4 个目标字段');
    expect(nodeDetail(node)).toBe('sentiment / keywords / summary');
  });

  it('条件：主行用符号表达比较，次行说明双分支', () => {
    const node = data('condition', { left: '{{ LLM1 }}', op: 'contains', right: 'error' });
    expect(nodeSummary(node)).toBe('{{ LLM1 }} 包含 error');
    expect(nodeDetail(node)).toBe('真 / 假 两个分支');
  });

  it('HTTP：从完整 URL 提取 host；未填完整时保持原样', () => {
    expect(nodeSummary(data('http', { url: 'https://api.example.com/v1/x' }))).toBe(
      'GET api.example.com',
    );
    expect(nodeSummary(data('http', { url: '{{ 输入1.url }}' }))).toBe('GET {{ 输入1.url }}');
  });

  it('输出：来源留空时提示"首个上游"', () => {
    expect(nodeSummary(data('output', { field: 'result' }))).toBe('result ← 首个上游');
  });
});
