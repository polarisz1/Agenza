import type { Edge, Node } from '@xyflow/react';
import type { components } from '@agentflow/contracts';

/**
 * 八类节点：**从后端契约派生**，不在前端手抄。
 * 后端加/删节点类型时，这里会立刻编译报错（NODE_META / DEFAULT_CONFIG 都要跟着补）。
 */
export type NodeType = NonNullable<components['schemas']['GraphDef']['nodes']>[number]['type'];

/** 节点运行态（PRD §7：排队 / 运行中 / 成功 / 失败 / 已跳过 / 已取消） */
export type RuntimeStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled';

/** 连线端口的数据类型 */
export type PortKind = 'text' | 'json' | 'bool';

export interface NodeData extends Record<string, unknown> {
  type: NodeType;
  label: string;
  config: Record<string, any>;
  runtimeStatus?: RuntimeStatus;
  hasIssue?: boolean;
}

export type EditorNode = Node<NodeData, NodeType>;

export interface NodeMeta {
  label: string;
  group: string;
  desc: string;
  color: string;
  hasInput: boolean;
  hasOutput: boolean;
  outputKind: PortKind | null;
  accepts: PortKind[];
}

export const NODE_META: Record<NodeType, NodeMeta> = {
  input: {
    label: '输入',
    group: '基础',
    desc: '工作流输入字段',
    color: '#3d5a80',
    hasInput: false,
    hasOutput: true,
    outputKind: 'json',
    accepts: [],
  },
  output: {
    label: '输出',
    group: '基础',
    desc: '最终结果展示',
    color: '#1f4e3d',
    hasInput: true,
    hasOutput: false,
    outputKind: null,
    accepts: ['text', 'json', 'bool'],
  },
  llm: {
    label: 'LLM 调用',
    group: '模型',
    desc: '大模型文本生成',
    color: '#1f4e3d',
    hasInput: true,
    hasOutput: true,
    outputKind: 'text',
    accepts: ['text', 'json', 'bool'],
  },
  extract: {
    label: '结构化抽取',
    group: '模型',
    desc: '提取为 JSON 对象',
    color: '#6b4e8a',
    hasInput: true,
    hasOutput: true,
    outputKind: 'json',
    accepts: ['text', 'json'],
  },
  http: {
    label: 'HTTP 请求',
    group: '工具',
    desc: '调用外部 API',
    color: '#a86612',
    hasInput: true,
    hasOutput: true,
    outputKind: 'json',
    accepts: ['text', 'json'],
  },
  python: {
    label: 'Python 脚本',
    group: '工具',
    desc: '子进程执行',
    color: '#b03a3a',
    hasInput: true,
    hasOutput: true,
    outputKind: 'json',
    accepts: ['text', 'json', 'bool'],
  },
  condition: {
    label: '条件分支',
    group: '流程控制',
    desc: '布尔判断分流',
    color: '#2c7a7b',
    hasInput: true,
    hasOutput: true,
    outputKind: 'bool',
    accepts: ['text', 'json', 'bool'],
  },
  merge: {
    label: '合并',
    group: '流程控制',
    desc: '汇聚多路输出',
    color: '#5a5a5a',
    hasInput: true,
    hasOutput: true,
    outputKind: 'json',
    accepts: ['text', 'json', 'bool'],
  },
};

export const NODE_GROUPS = ['基础', '模型', '工具', '流程控制'] as const;

export const NODE_DRAG_MIME = 'application/agentflow-node';

/** 通用设置在所有节点 config 里都存在 */
const COMMON_CONFIG = {
  enabled: true,
  retry: 0,
  timeout_s: 120,
  notes: '',
};

export const DEFAULT_CONFIG: Record<NodeType, Record<string, any>> = {
  input: {
    ...COMMON_CONFIG,
    key: 'text',
    data_type: 'text',
    required: false,
    default: '',
    description: '',
  },
  llm: {
    ...COMMON_CONFIG,
    provider_id: '',
    model: '',
    system: '',
    prompt: '',
    temperature: 0.7,
    max_tokens: 2048,
    format: 'text',
  },
  extract: {
    ...COMMON_CONFIG,
    provider_id: '',
    model: '',
    prompt: '',
    fields_text: '',
    format: 'json',
    timeout_s: 180,
  },
  http: {
    ...COMMON_CONFIG,
    method: 'GET',
    url: '',
    headers: '{}',
    body: '',
    timeout_s: 30,
  },
  python: {
    ...COMMON_CONFIG,
    script:
      '# 输入：data["inputs"] / data["upstream"]（input.json 为 UTF-8）\n' +
      'import json\n' +
      'from pathlib import Path\n' +
      "data = json.loads(Path('input.json').read_text(encoding='utf-8'))\n" +
      'agentflow_result = {"ok": True, "inputs": data["inputs"]}\n',
    timeout_s: 60,
  },
  condition: {
    ...COMMON_CONFIG,
    left: '',
    op: 'eq',
    right: '',
  },
  merge: {
    ...COMMON_CONFIG,
    strategy: 'all',
    field: 'merged',
  },
  output: {
    ...COMMON_CONFIG,
    field: 'result',
    source: '',
    format: 'text',
  },
};

/** 条件比较符（与后端 condition 执行器一致） */
export const CONDITION_OPS = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'is_empty', label: '为空' },
] as const;

export const STATUS_TEXT: Record<RuntimeStatus, string> = {
  queued: '◷ 排队',
  running: '● 运行中',
  success: '✓ 成功',
  failed: '✕ 失败',
  skipped: '⊘ 已跳过',
  cancelled: '⊘ 已取消',
};

export type GraphDef = components['schemas']['GraphDef'];
export type WorkflowInputField = components['schemas']['WorkflowInputField'];
export type WorkflowStatus = components['schemas']['WorkflowListItem']['status'];
export type ValidateIssue = components['schemas']['ValidateIssue'];

export function uid(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createNodeData(type: NodeType, seq: number): NodeData {
  return {
    type,
    label: `${labelPrefix(type)}${seq}`,
    config: { ...DEFAULT_CONFIG[type] },
  };
}

function labelPrefix(type: NodeType): string {
  switch (type) {
    case 'input':
      return '输入';
    case 'llm':
      return 'LLM';
    case 'extract':
      return '抽取';
    case 'http':
      return 'HTTP';
    case 'python':
      return '脚本';
    case 'condition':
      return '条件';
    case 'merge':
      return '合并';
    case 'output':
      return '输出';
  }
}

/** 节点卡片上的摘要行 */
export function nodeSummary(data: NodeData): string {
  const c = data.config || {};
  switch (data.type) {
    case 'input':
      return `字段 ${c.key || '未命名'} · ${c.data_type || 'text'}`;
    case 'llm':
      return c.model ? `${c.model} · T=${c.temperature ?? 0.7}` : '未选择模型';
    case 'extract':
      return c.fields_text
        ? `${String(c.fields_text).split('\n').filter(Boolean).length} 个目标字段`
        : '未设置目标字段';
    case 'http':
      return `${c.method || 'GET'} ${c.url || '未填写地址'}`;
    case 'python':
      return `脚本 ${String(c.script || '').split('\n').length} 行 · 超时 ${c.timeout_s ?? 60}s`;
    case 'condition':
      return `${c.left || '?'} ${c.op || 'eq'} ${c.right || '?'}`;
    case 'merge':
      return `${c.strategy === 'any' ? '任一到达' : '全部到达'} → ${c.field || 'merged'}`;
    case 'output':
      return `${c.field || 'result'} ← ${c.source || '未选择来源'}`;
    default:
      return '';
  }
}

/** 节点标签能否作为变量引用源（不能含空格、点、花括号） */
export function isVariableSafeLabel(label: string): boolean {
  return /^[^\s.{}]+$/.test(label);
}

export function canConnect(source: NodeType, target: NodeType): boolean {
  // 条件节点输出的是"控制流"（走哪条分支），不承载数据，因此不参与端口类型矩阵：
  // 下游的数据仍然从各自的祖先节点解析，这里只要求对端有输入端口。
  if (source === 'condition') return NODE_META[target].hasInput;

  const sourceKind = NODE_META[source].outputKind;
  if (!sourceKind) return false;
  return NODE_META[target].accepts.includes(sourceKind);
}

// ---------------- 图序列化 ----------------
// 图结构完全复用后端契约（GraphDef），此文件不再手写节点/边的形状。

function safeParseObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 非合法 JSON：按空对象处理，避免运行期直接报 422
    }
  }
  return {};
}

/** 从输入节点推导工作流级 inputs（输入节点是唯一事实源） */
export function extractWorkflowInputs(nodes: EditorNode[]): WorkflowInputField[] {
  return nodes
    .filter((n) => n.data.type === 'input')
    .map((n) => {
      const c = n.data.config;
      return {
        key: String(c.key || n.data.label),
        label: String(c.key || n.data.label),
        type: (c.data_type || 'text') as WorkflowInputField['type'],
        required: Boolean(c.required),
        default: c.default ?? null,
      };
    });
}

export function serializeGraph(nodes: EditorNode[], edges: Edge[]): GraphDef {
  const graph = {
    version: 1,
    inputs: extractWorkflowInputs(nodes),
    nodes: nodes.map((n) => {
      const config = { ...n.data.config };
      if (n.data.type === 'http') {
        config.headers = safeParseObject(config.headers);
      }
      return {
        id: n.id,
        type: n.data.type,
        name: n.data.label,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        config,
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      // 条件节点的分支端口由 sourceHandle 承载（React Flow 原生字段）
      from_port: e.sourceHandle === 'true' ? 'true' : e.sourceHandle === 'false' ? 'false' : null,
    })),
  };

  // 编辑器内部 config 是宽松的 Record<string, any>（属性面板逐字段编辑），
  // 与后端判别联合无法在编译期逐字段对齐；契约在后端保存/校验时把关，
  // 因此这里只做一次边界断言，避免在调用点散落 `as any`。
  return graph as GraphDef;
}

export function deserializeGraph(graph: any): { nodes: EditorNode[]; edges: Edge[] } {
  const rawNodes: any[] = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rawEdges: any[] = Array.isArray(graph?.edges) ? graph.edges : [];

  const nodes: EditorNode[] = rawNodes.map((n) => {
    const type = (NODE_META as Record<string, NodeMeta>)[n.type] ? (n.type as NodeType) : 'python';
    const config = { ...DEFAULT_CONFIG[type], ...(n.config || {}) };
    // 后端返回的 headers 是对象，编辑器内用 JSON 文本编辑
    if (type === 'http' && config.headers && typeof config.headers === 'object') {
      config.headers = JSON.stringify(config.headers, null, 2);
    }
    return {
      id: String(n.id),
      type,
      position: {
        x: Number(n.position?.x ?? 0),
        y: Number(n.position?.y ?? 0),
      },
      data: {
        type,
        label: String(n.name || NODE_META[type].label),
        config,
      },
    };
  });

  const edges: Edge[] = rawEdges.map((e) => {
    const fromPort = e.from_port === 'true' || e.from_port === 'false' ? e.from_port : undefined;
    return {
      id: String(e.id || `e_${e.source}_${e.target}`),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: fromPort,
      label: fromPort === 'true' ? '真' : fromPort === 'false' ? '假' : undefined,
    };
  });

  return { nodes, edges };
}
