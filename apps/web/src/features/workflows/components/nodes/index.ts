import type { NodeTypes } from '@xyflow/react';

import InputNode from './InputNode';
import LlmNode from './LlmNode';
import ExtractNode from './ExtractNode';
import HttpNode from './HttpNode';
import PythonNode from './PythonNode';
import ConditionNode from './ConditionNode';
import MergeNode from './MergeNode';
import OutputNode from './OutputNode';

/** 节点类型 → 自定义渲染组件（Design §D9） */
export const nodeTypes = {
  input: InputNode,
  llm: LlmNode,
  extract: ExtractNode,
  http: HttpNode,
  python: PythonNode,
  condition: ConditionNode,
  merge: MergeNode,
  output: OutputNode,
} satisfies NodeTypes;
