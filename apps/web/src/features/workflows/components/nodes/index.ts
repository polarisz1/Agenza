import type { NodeTypes } from '@xyflow/react';

import BaseNode from './BaseNode';
import InputNode from './InputNode';
import LlmNode from './LlmNode';
import ExtractNode from './ExtractNode';
import HttpNode from './HttpNode';
import PythonNode from './PythonNode';
import ConditionNode from './ConditionNode';
import MergeNode from './MergeNode';
import OutputNode from './OutputNode';

/**
 * 节点类型 → 自定义渲染组件（Design §D9）。
 *
 * `unknown` 是编辑器给"不认识的类型"的占位渲染（F7）：必须登记在这里，
 * 否则 React Flow 会退回默认节点（没有端口、没有提示），用户看不出发生了什么。
 * 数据本身原样保留，保存时按 `unknownType` 写回。
 */
export const nodeTypes = {
  unknown: BaseNode,
  input: InputNode,
  llm: LlmNode,
  extract: ExtractNode,
  http: HttpNode,
  python: PythonNode,
  condition: ConditionNode,
  merge: MergeNode,
  output: OutputNode,
} satisfies NodeTypes;
