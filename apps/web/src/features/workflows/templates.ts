import { DEFAULT_CONFIG, type GraphDef, type NodeType, type WorkflowInputField } from './types';

interface NodeSpec {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

type EdgeSpec = [source: string, target: string, fromPort?: 'true' | 'false'];

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  /** 是否需要先配置模型服务商（UI 标签 + 引导判断） */
  needsProvider: boolean;
  build: () => GraphDef;
}

function parseHeaders(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 非法 JSON：退化为空对象，避免把字符串发往后端触发 422
    }
  }
  return {};
}

function buildGraph(specs: NodeSpec[], edges: EdgeSpec[]): GraphDef {
  const inputs = specs
    .filter((spec) => spec.type === 'input')
    .map((spec) => {
      const key = String(spec.config?.key || spec.name);
      return {
        key,
        label: key,
        type: (spec.config?.data_type || 'text') as WorkflowInputField['type'],
        required: Boolean(spec.config?.required),
        default: spec.config?.default ?? null,
      };
    });

  const graph = {
    version: 1,
    inputs,
    nodes: specs.map((spec) => {
      const config: Record<string, unknown> = {
        ...DEFAULT_CONFIG[spec.type],
        ...(spec.config ?? {}),
      };
      // 编辑器里 headers 是 JSON 文本，后端契约要求是对象；模板直接落库，
      // 必须在这里归一化，否则创建 HTTP 模板时会被 422 拒绝。
      if (spec.type === 'http') {
        config.headers = parseHeaders(config.headers);
      }
      return {
        id: spec.id,
        type: spec.type,
        name: spec.name,
        position: { x: spec.x, y: spec.y },
        config,
      };
    }),
    edges: edges.map(([source, target, fromPort]) => ({
      id: `e_${source}_${target}${fromPort ? `_${fromPort}` : ''}`,
      source,
      target,
      ...(fromPort ? { from_port: fromPort } : {}),
    })),
  };

  // 模板里的 config 由 DEFAULT_CONFIG 拼装，编译期无法逐字段对齐判别联合，
  // 与 serializeGraph 同理只做一次边界断言（真正的把关在后端 schema）。
  return graph as GraphDef;
}

const PYTHON_TRANSFORM_SCRIPT =
  'import json\n' +
  'from pathlib import Path\n' +
  "data = json.loads(Path('input.json').read_text(encoding='utf-8'))\n" +
  'text = data["inputs"].get("text", "")\n' +
  'agentflow_result = {"length": len(text), "upper": text.upper()}\n';

const PYTHON_CLEAN_SCRIPT =
  'import json\n' +
  'from pathlib import Path\n' +
  "data = json.loads(Path('input.json').read_text(encoding='utf-8'))\n" +
  'raw = data["inputs"].get("payload", [])\n' +
  'if isinstance(raw, str):\n' +
  "    raw = json.loads(raw or '[]')\n" +
  'items = [item for item in raw if item]\n' +
  'agentflow_result = {"count": len(items), "items": items}\n';

/** 内置工作流模板（v0.2：8 个，其中 4 个无需模型即可跑通） */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'summary-llm',
    name: '文本摘要（LLM）',
    description: '输入一段文本 → LLM 摘要 → 输出。需要先在「模型配置」添加服务商',
    needsProvider: true,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 80,
            config: { key: 'text', required: true, description: '待摘要的原文' },
          },
          {
            id: 'n_llm',
            type: 'llm',
            name: 'LLM1',
            x: 340,
            y: 80,
            config: {
              system: '你是一个简洁的文本摘要助手。',
              prompt: '请用 3 句话摘要以下内容：\n\n{{ 输入1.text }}',
              temperature: 0.3,
              max_tokens: 512,
            },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 620,
            y: 80,
            config: { field: 'result', source: '{{ LLM1 }}', format: 'text' },
          },
        ],
        [
          ['n_input', 'n_llm'],
          ['n_llm', 'n_output'],
        ],
      ),
  },
  {
    key: 'fetch-summary',
    name: '网页抓取 + 摘要',
    description: '输入 URL → HTTP 抓取 → LLM 摘要 → 输出',
    needsProvider: true,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 80,
            config: { key: 'url', required: true, description: '网页地址' },
          },
          {
            id: 'n_http',
            type: 'http',
            name: 'HTTP1',
            x: 340,
            y: 80,
            config: { method: 'GET', url: '{{ 输入1.url }}', timeout_s: 30 },
          },
          {
            id: 'n_llm',
            type: 'llm',
            name: 'LLM1',
            x: 620,
            y: 80,
            config: {
              system: '你是网页摘要助手。',
              prompt: '请摘要以下网页内容：\n\n{{ HTTP1.body }}',
              temperature: 0.3,
              max_tokens: 512,
            },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 900,
            y: 80,
            config: { field: 'result', source: '{{ LLM1 }}', format: 'text' },
          },
        ],
        [
          ['n_input', 'n_http'],
          ['n_http', 'n_llm'],
          ['n_llm', 'n_output'],
        ],
      ),
  },
  {
    key: 'python-transform',
    name: 'Python 数据处理',
    description: '输入 → Python 脚本处理 → 输出（无需模型服务商即可运行）',
    needsProvider: false,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 80,
            config: { key: 'text', required: true, description: '待处理文本' },
          },
          {
            id: 'n_python',
            type: 'python',
            name: '脚本1',
            x: 340,
            y: 80,
            config: { script: PYTHON_TRANSFORM_SCRIPT },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 620,
            y: 80,
            // 显式声明来源：留空时 output 执行器取"首个上游"，节点一多就不确定了
            config: { field: 'result', source: '{{ 脚本1 }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_python'],
          ['n_python', 'n_output'],
        ],
      ),
  },
  {
    key: 'extract-fields',
    name: '结构化抽取',
    description: '输入文本 → 按目标字段抽取为 JSON → 输出',
    needsProvider: true,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 80,
            config: { key: 'text', required: true, description: '待抽取的原文' },
          },
          {
            id: 'n_extract',
            type: 'extract',
            name: '抽取1',
            x: 340,
            y: 80,
            config: {
              prompt: '从下面的内容里抽取字段：\n\n{{ 输入1.text }}',
              fields_text: 'sentiment: 情感倾向\nkeywords: 关键词\nsummary: 一句话摘要',
              format: 'json',
              temperature: 0.2,
            },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 620,
            y: 80,
            config: { field: 'result', source: '{{ 抽取1 }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_extract'],
          ['n_extract', 'n_output'],
        ],
      ),
  },
  {
    key: 'classify-branch',
    name: '分类分流（LLM + 条件）',
    description: 'LLM 判断情感 → 条件节点分成正面 / 负面两条输出',
    needsProvider: true,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 120,
            config: { key: 'text', required: true, description: '待分类文本' },
          },
          {
            id: 'n_llm',
            type: 'llm',
            name: 'LLM1',
            x: 320,
            y: 120,
            config: {
              system: '你是一个情感分类器，只输出「正面」或「负面」，不要解释。',
              prompt: '{{ 输入1.text }}',
              temperature: 0,
              max_tokens: 16,
            },
          },
          {
            id: 'n_cond',
            type: 'condition',
            name: '条件1',
            x: 600,
            y: 120,
            config: { left: '{{ LLM1 }}', op: 'contains', right: '正面' },
          },
          {
            id: 'n_pos',
            type: 'output',
            name: '正面输出',
            x: 880,
            y: 40,
            config: { field: 'result', source: '{{ 条件1 }}', format: 'json' },
          },
          {
            id: 'n_neg',
            type: 'output',
            name: '负面输出',
            x: 880,
            y: 220,
            config: { field: 'result', source: '{{ 条件1 }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_llm'],
          ['n_llm', 'n_cond'],
          ['n_cond', 'n_pos', 'true'],
          ['n_cond', 'n_neg', 'false'],
        ],
      ),
  },
  {
    key: 'http-aggregate',
    name: 'HTTP 请求 → 输出',
    description: '输入 URL → 抓取 JSON → 输出（无需模型服务商即可运行）',
    needsProvider: false,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 80,
            config: { key: 'url', required: true, description: '接口地址' },
          },
          {
            id: 'n_http',
            type: 'http',
            name: 'HTTP1',
            x: 340,
            y: 80,
            config: { method: 'GET', url: '{{ 输入1.url }}', timeout_s: 30 },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 620,
            y: 80,
            config: { field: 'result', source: '{{ HTTP1.body }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_http'],
          ['n_http', 'n_output'],
        ],
      ),
  },
  {
    key: 'python-json-clean',
    name: 'JSON 清洗（Python）',
    description: '输入 JSON 数组 → 脚本过滤空值并计数 → 输出（无需模型）',
    needsProvider: false,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 80,
            config: {
              key: 'payload',
              data_type: 'json',
              required: true,
              description: 'JSON 数组，如 [1, null, 2]',
            },
          },
          {
            id: 'n_python',
            type: 'python',
            name: '脚本1',
            x: 340,
            y: 80,
            config: { script: PYTHON_CLEAN_SCRIPT },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 620,
            y: 80,
            config: { field: 'result', source: '{{ 脚本1 }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_python'],
          ['n_python', 'n_output'],
        ],
      ),
  },
  {
    key: 'condition-split',
    name: '条件分流（无需模型）',
    description: '文本包含 error 走一支，否则走另一支（无需模型服务商）',
    needsProvider: false,
    build: () =>
      buildGraph(
        [
          {
            id: 'n_input',
            type: 'input',
            name: '输入1',
            x: 60,
            y: 120,
            config: { key: 'text', required: false, description: '待判断文本' },
          },
          {
            id: 'n_cond',
            type: 'condition',
            name: '条件1',
            x: 340,
            y: 120,
            config: { left: '{{ 输入1.text }}', op: 'contains', right: 'error' },
          },
          {
            id: 'n_hit',
            type: 'output',
            name: '命中输出',
            x: 620,
            y: 40,
            config: { field: 'result', source: '{{ 条件1 }}', format: 'json' },
          },
          {
            id: 'n_miss',
            type: 'output',
            name: '未命中输出',
            x: 620,
            y: 220,
            config: { field: 'result', source: '{{ 条件1 }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_cond'],
          ['n_cond', 'n_hit', 'true'],
          ['n_cond', 'n_miss', 'false'],
        ],
      ),
  },
];

/** 模板标识 → 模板（引导/列表复用） */
export function getTemplate(key: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.key === key);
}
