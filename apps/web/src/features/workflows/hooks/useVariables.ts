import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';

import { isVariableSafeLabel, type EditorNode } from '../types';

export interface VariableItem {
  token: string;
  nodeId: string;
  nodeLabel: string;
  /** null 表示直接引用整个节点输出（标量，如 LLM 文本） */
  field: string | null;
}

/** 收集当前节点的全部祖先（上游）节点 id */
function collectAncestors(nodeId: string, edges: Edge[]): Set<string> {
  const parents = new Map<string, string[]>();
  for (const e of edges) {
    parents.set(e.target, [...(parents.get(e.target) ?? []), e.source]);
  }

  const seen = new Set<string>();
  const stack = [...(parents.get(nodeId) ?? [])];
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(parents.get(id) ?? []));
  }
  return seen;
}

/** 推断某个节点输出的字段名；null 表示直接引用整个节点（标量输出） */
function inferFields(node: EditorNode, output: unknown): string[] | null {
  if (output !== undefined && output !== null) {
    if (typeof output === 'object') {
      if (Array.isArray(output)) return output.length ? ['[0]'] : null;
      const keys = Object.keys(output as Record<string, unknown>);
      return keys.length ? keys : null;
    }
    // 字符串 / 数字 / 布尔：直接引用 {{ 节点 }}
    return null;
  }

  const c = node.data.config || {};
  switch (node.data.type) {
    case 'input':
      return [String(c.key || 'value')];
    case 'condition':
      return ['condition'];
    case 'merge':
      return [String(c.field || 'merged')];
    case 'output':
      return [String(c.field || 'result')];
    default:
      return null;
  }
}

function buildVariables(
  nodes: EditorNode[],
  edges: Edge[],
  focusNodeId: string | null,
  outputs: Record<string, unknown>,
): VariableItem[] {
  if (!focusNodeId) return [];

  const ancestors = collectAncestors(focusNodeId, edges);
  const items: VariableItem[] = [];

  for (const node of nodes) {
    if (!ancestors.has(node.id)) continue;
    if (!isVariableSafeLabel(node.data.label)) continue; // 含空格/点/花括号的名称无法被变量解析

    const fields = inferFields(node, outputs[node.id]);
    if (fields === null) {
      items.push({
        token: `{{ ${node.data.label} }}`,
        nodeId: node.id,
        nodeLabel: node.data.label,
        field: null,
      });
      continue;
    }
    for (const field of fields) {
      items.push({
        token: `{{ ${node.data.label}.${field} }}`,
        nodeId: node.id,
        nodeLabel: node.data.label,
        field,
      });
    }
  }
  return items;
}

/**
 * 当前选中节点可用的变量列表。
 * 可用变量随节点、连线与最近一次运行输出实时变化。
 */
export function useVariables(
  nodes: EditorNode[],
  edges: Edge[],
  focusNodeId: string | null,
  outputs: Record<string, unknown>,
): VariableItem[] {
  return useMemo(
    () => buildVariables(nodes, edges, focusNodeId, outputs),
    [nodes, edges, focusNodeId, outputs],
  );
}
