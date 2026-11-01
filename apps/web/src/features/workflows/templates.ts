import { DEFAULT_CONFIG, type GraphDef, type NodeType, type WorkflowInputField } from './types';

interface NodeSpec {
  id: string;
  type: NodeType;
  name: string;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

export interface WorkflowTemplate {
  key: string;
  name: string;
  description: string;
  build: () => GraphDef;
}

function buildGraph(specs: NodeSpec[], edges: [string, string][]): GraphDef {
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
    nodes: specs.map((spec) => ({
      id: spec.id,
      type: spec.type,
      name: spec.name,
      position: { x: spec.x, y: spec.y },
      config: { ...DEFAULT_CONFIG[spec.type], ...(spec.config ?? {}) },
    })),
    edges: edges.map(([source, target]) => ({
      id: `e_${source}_${target}`,
      source,
      target,
    })),
  };

  // 模板里的 config 由 DEFAULT_CONFIG 拼装，编译期无法逐字段对齐判别联合，
  // 与 serializeGraph 同理只做一次边界断言（真正的把关在后端 schema）。
  return graph as GraphDef;
}

/** 内置工作流模板（新建入口 → 从模板创建） */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'summary-llm',
    name: '文本摘要（LLM）',
    description: '输入一段文本 → LLM 摘要 → 输出。需要先在「模型配置」添加服务商',
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
            config: {
              script:
                'import json\n' +
                'from pathlib import Path\n' +
                "data = json.loads(Path('input.json').read_text(encoding='utf-8'))\n" +
                'text = data["inputs"].get("text", "")\n' +
                'agentflow_result = {"length": len(text), "upper": text.upper()}\n',
            },
          },
          {
            id: 'n_output',
            type: 'output',
            name: '输出1',
            x: 620,
            y: 80,
            // 显式声明来源：留空时 output 执行器取"首个上游"，节点一多就不确定了（评审 G28）
            config: { field: 'result', source: '{{ 脚本1 }}', format: 'json' },
          },
        ],
        [
          ['n_input', 'n_python'],
          ['n_python', 'n_output'],
        ],
      ),
  },
];
