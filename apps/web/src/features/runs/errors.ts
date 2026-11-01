/**
 * 运行错误分类（F1）。
 *
 * 后端只给一段文本（`NodeRunDetail.error` / `RunDetail.error`）。用户真正需要的是
 * "这是哪一类问题、我该去哪里改"。分类放在前端，避免为纯展示信息改契约。
 *
 * 规则是**顺序匹配**：越具体的越靠前（鉴权 → 服务商 → 超时 → 网络 → 脚本 →
 * 变量 → JSON → 内部）。没有命中时给通用指引，绝不返回空。
 */

export type RunErrorKind =
  | 'auth'
  | 'provider'
  | 'timeout'
  | 'network'
  | 'script'
  | 'variable'
  | 'json'
  | 'internal'
  | 'unknown';

export interface RunErrorInfo {
  kind: RunErrorKind;
  /** 短标签，用于徽标/行内 */
  label: string;
  /** 一句建议，告诉用户下一步做什么 */
  suggestion: string;
  /** 可选动作；由调用方决定跳转目标 */
  action?: { label: string; target: 'models' | 'node' };
}

interface Rule extends RunErrorInfo {
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    kind: 'auth',
    label: '鉴权失败',
    suggestion: '检查服务商密钥是否正确、是否过期；可在「模型配置」里点「测试」验证。',
    action: { label: '去模型配置', target: 'models' },
    pattern: /鉴权|401|403|api[ _-]?key|密钥|decrypt|unauthorized/i,
  },
  {
    kind: 'provider',
    label: '服务商不可用',
    suggestion: '服务商可能已停用或地址填错；确认「模型配置」里的地址与默认模型。',
    action: { label: '去模型配置', target: 'models' },
    pattern: /服务商|provider|unsupported kind|模型未|no executor/i,
  },
  {
    kind: 'timeout',
    label: '执行超时',
    suggestion: '调大该节点的「超时（秒）」，或检查模型/接口响应是否过慢。',
    action: { label: '打开节点', target: 'node' },
    pattern: /超时|timed?[ _-]?out|timeout/i,
  },
  {
    kind: 'network',
    label: '网络连接失败',
    suggestion: '检查地址、网络与代理；本地服务（如 Ollama）确认已启动。',
    pattern: /无法连接|连接失败|connection|connecterror|network|dns|502|503|504|proxy/i,
  },
  {
    kind: 'script',
    label: '脚本执行失败',
    suggestion: '检查脚本是否给 agentflow_result 赋值、退出码是否为 0；可先「调试此节点」。',
    action: { label: '打开节点', target: 'node' },
    pattern: /脚本|script exit|agentflow_result|子进程|python|SyntaxError/i,
  },
  {
    kind: 'variable',
    label: '变量解析失败',
    suggestion: '检查 {{ 节点.字段 }} 的节点名与字段名是否存在；上游是否被跳过。',
    action: { label: '打开节点', target: 'node' },
    pattern: /变量|variable|missing key|unknown variable|unknown field|解析/i,
  },
  {
    kind: 'json',
    label: 'JSON 解析失败',
    suggestion: '模型没有返回合法 JSON 时会出现；可加强提示词，或在抽取节点里明确字段。',
    pattern: /json|parse failed|not valid/i,
  },
  {
    kind: 'internal',
    label: '内部错误',
    suggestion: '这是程序内部异常；可复制错误信息反馈，或重启应用后重试。',
    pattern: /notimplemented|无错误信息|internal|traceback/i,
  },
];

const FALLBACK: RunErrorInfo = {
  kind: 'unknown',
  label: '运行失败',
  suggestion: '展开节点查看错误详情；必要时用「调试此节点」单独执行一次。',
};

/** 把错误文本映射成"类别 + 建议 + 动作"。空文本也返回可读结果。 */
export function classifyRunError(message?: string | null): RunErrorInfo {
  const text = (message || '').trim();
  if (!text) return FALLBACK;

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      const { pattern: _pattern, ...info } = rule;
      void _pattern;
      return info;
    }
  }
  return FALLBACK;
}

/** 是否是"节点级"错误（用于决定展示位置）。 */
export function isBlockingRunError(message?: string | null): boolean {
  return Boolean((message || '').trim());
}
