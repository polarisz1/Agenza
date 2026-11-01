import type { Edge, Node } from '@xyflow/react';
import type { components } from '@agentflow/contracts';

/**
 * 八类节点：**从后端契约派生**，不在前端手抄。
 * 后端加/删节点类型时，这里会立刻编译报错（NODE_META / DEFAULT_CONFIG 都要跟着补）。
 */
export type NodeType = NonNullable<components['schemas']['GraphDef']['nodes']>[number]['type'];

/**
 * 编辑器里的节点类型：已知类型 + `unknown`。
 *
 * 打开旧版本/未来版本的工作流时可能遇到编辑器不认识的类型。**不能**把它降级成
 * `python`（那样一保存就把数据写坏了），而是原样保留原始 type、用 `unknown` 渲染，
 * 保存时再写回去（评审 F7）。
 */
export type EditorNodeType = NodeType | 'unknown';

/** 节点运行态（PRD §7：排队 / 运行中 / 成功 / 失败 / 已跳过 / 已取消） */
export type RuntimeStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled';

/** 连线端口的数据类型 */
export type PortKind = 'text' | 'json' | 'bool';

export interface NodeData extends Record<string, unknown> {
  type: EditorNodeType;
  label: string;
  config: Record<string, any>;
  /** 未知类型节点保留的原始 type，保存时原样写回 */
  unknownType?: string;
  runtimeStatus?: RuntimeStatus;
  hasIssue?: boolean;
}

export type EditorNode = Node<NodeData, EditorNodeType>;

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

export const NODE_META: Record<EditorNodeType, NodeMeta> = {
  unknown: {
    label: '未知节点',
    group: '其他',
    desc: '编辑器不认识的节点类型（只读保留，不会被改写）',
    color: '#b03a3a',
    hasInput: true,
    hasOutput: true,
    outputKind: 'json',
    accepts: ['text', 'json', 'bool'],
  },
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

/** 下一个可用的节点名序号：按已有标签里的**最大编号 +1**，删掉节点后不会重名（F8）。 */
export function nextLabel(type: NodeType, existingLabels: string[]): string {
  const prefix = labelPrefix(type);
  const used = existingLabels
    .map((label) => label.match(new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`)))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => Number(m[1]));
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `${prefix}${next}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    case 'unknown':
      return `未知类型 ${data.unknownType ?? ''}（原样保留，不会被改写）`;
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

export function canConnect(source: EditorNodeType, target: EditorNodeType): boolean {
  // 条件节点输出的是"控制流"（走哪条分支），不承载数据，因此不参与端口类型矩阵：
  // 下游的数据仍然从各自的祖先节点解析，这里只要求对端有输入端口。
  if (source === 'condition') return NODE_META[target].hasInput;

  const sourceKind = NODE_META[source].outputKind;
  if (!sourceKind) return false;
  return NODE_META[target].accepts.includes(sourceKind);
}

// ---------------- 连线校验（评审 G21） ----------------
// 只查类型矩阵时，画布允许造环、也允许把多条线灌进单输入节点，只能等后端 422 兜底。
// 这里把三条规则前移到画布：类型矩阵 / 入度 / 无环。口径与后端 validators 一致，
// 但**只拦"新画的线"**——历史图里的既有连线不会被这里改写。

/** 允许汇聚多路输入的类型（其余节点只有一个输入端口）。 */
const MULTI_INPUT_TYPES: ReadonlySet<EditorNodeType> = new Set(['merge']);

/** 从 `from` 出发沿有向边能否到达 `to`。 */
export function hasPath(
  edges: Pick<Edge, 'source' | 'target'>[],
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const next = adjacency.get(edge.source);
    if (next) next.push(edge.target);
    else adjacency.set(edge.source, [edge.target]);
  }

  const seen = new Set<string>([from]);
  const stack = [from];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const next of adjacency.get(current) ?? []) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

/** 目标节点已有的入边数量（同一条边重复画不算）。 */
export function countIncoming(
  edges: Pick<Edge, 'id' | 'source' | 'target' | 'sourceHandle'>[],
  targetId: string,
): number {
  const keys = new Set<string>();
  for (const edge of edges) {
    if (edge.target === targetId) keys.add(`${edge.source}:${edge.sourceHandle ?? ''}`);
  }
  return keys.size;
}

interface ConnectionLike {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
}

/**
 * 校验一条待建立的连线，返回**可读的中文原因**；无问题时返回 null。
 *
 * `nodes` 只用来查两端节点的类型；连线集合用于环/入度判断。
 */
export function connectionIssue(
  nodes: EditorNode[],
  edges: Pick<Edge, 'id' | 'source' | 'target' | 'sourceHandle'>[],
  connection: ConnectionLike,
): string | null {
  const { source, target } = connection;
  if (!source || !target) return '连线缺少端点';
  if (source === target) return '不能连接到自身';

  const sourceNode = nodes.find((node) => node.id === source);
  const targetNode = nodes.find((node) => node.id === target);
  if (!sourceNode || !targetNode) return '节点不存在';

  const sourceType = sourceNode.data.type;
  const targetType = targetNode.data.type;

  // 条件节点必须从「真 / 假」端口出线，否则两条分支都会执行（PRD §5.3）
  if (sourceType === 'condition') {
    const port = connection.sourceHandle;
    if (port !== 'true' && port !== 'false') {
      return '请从条件节点的「真」或「假」端口连线';
    }
  }

  if (!NODE_META[targetType].hasInput) return '目标节点没有输入端口';
  if (!canConnect(sourceType, targetType)) return '端口类型不匹配';

  // 入度：除 merge 外每个节点只接受一个上游
  if (!MULTI_INPUT_TYPES.has(targetType) && countIncoming(edges, target) > 0) {
    return '该节点只接受一个输入；需要汇聚多路请改用「合并」节点';
  }

  // 环：target 若已能到达 source，再加 source → target 就成环
  if (hasPath(edges, target, source)) return '这条连线会形成环路';

  return null;
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
        // 未知类型节点原样写回原始 type，绝不改成编辑器认识的类型（F7）
        type: n.data.unknownType ?? n.data.type,
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
    const known = (NODE_META as Record<string, NodeMeta>)[n.type] !== undefined;
    const type: EditorNodeType = known ? (n.type as NodeType) : 'unknown';
    const config = {
      ...(known ? DEFAULT_CONFIG[type as NodeType] : {}),
      ...(n.config || {}),
    };
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
        // 未知类型保留原始 type，保存时原样写回（F7：不降级、不篡改）
        ...(known ? {} : { unknownType: String(n.type ?? '') }),
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
