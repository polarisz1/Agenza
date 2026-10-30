import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { message } from 'antd';

import {
  CONDITION_OPS,
  NODE_META,
  isVariableSafeLabel,
} from '../types';
import { listProviderOptions, type NodeTestResult, type ProviderOption } from '../api';
import type { VariableItem } from '../hooks/useVariables';
import { useEditorStore } from '../hooks/useEditorStore';

interface Props {
  variables: VariableItem[];
  latestOutputs: Record<string, unknown>;
  onDebug: (nodeId: string) => Promise<NodeTestResult>;
}

type FieldElement = HTMLInputElement | HTMLTextAreaElement;
type FieldRef = (el: FieldElement | null) => void;

function pretty(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="afe-field">
      <label>{label}</label>
      {children}
      {hint && <div className="afe-hint">{hint}</div>}
    </div>
  );
}

/** 右侧属性面板：按节点类型渲染表单 + 变量选择器 + 最近输出 + 单节点调试 */
export default function PropertyPanel({ variables, latestOutputs, onDebug }: Props) {
  const nodes = useEditorStore((s) => s.nodes);
  const selectedId = useEditorStore((s) => s.selectedId);
  const historyVersion = useEditorStore((s) => s.historyVersion);
  const beginHistory = useEditorStore((s) => s.beginHistory);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [labelDraft, setLabelDraft] = useState('');
  const [tab, setTab] = useState<'params' | 'output'>('params');
  const [debugging, setDebugging] = useState(false);
  const [debugResult, setDebugResult] = useState<NodeTestResult | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const refs = useRef<Record<string, FieldElement | null>>({});

  // 切换节点 / 撤销重做后，同步表单草稿
  useEffect(() => {
    if (!selected) {
      setDraft({});
      setLabelDraft('');
      setDebugResult(null);
      return;
    }
    setDraft({ ...selected.data.config });
    setLabelDraft(selected.data.label);
    setDebugResult(null);
    setTab('params');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, historyVersion]);

  // 参数输入 300ms 防抖提交到 store
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      useEditorStore.getState().updateNodeConfig(selectedId, draft);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, selectedId]);

  // 名称同样防抖
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => {
      useEditorStore.getState().updateLabel(selectedId, labelDraft.trim() || NODE_META[selected?.data.type ?? 'python'].label);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelDraft, selectedId]);

  useEffect(() => {
    listProviderOptions().then(setProviders).catch(() => setProviders([]));
  }, []);

  const setField = (key: string, value: unknown) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const register = (field: string): FieldRef => (el) => {
    refs.current[field] = el;
  };

  const insertToken = (field: string, token: string) => {
    const el = refs.current[field];
    const current = String(draft[field] ?? '');
    if (!el) {
      setField(field, current + token);
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? start;
    const next = current.slice(0, start) + token + current.slice(end);
    setField(field, next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const renderVariables = (field: string) => {
    if (!variables.length) {
      return <div className="afe-hint">暂无可用变量：先连接上游节点</div>;
    }
    return (
      <div className="afe-hint">
        可用变量：
        {variables.map((v) => (
          <button
            type="button"
            key={v.token}
            className="afe-var-chip"
            title={`插入到「${field}」光标处`}
            onClick={() => insertToken(field, v.token)}
          >
            {v.token}
          </button>
        ))}
      </div>
    );
  };

  const handleDebug = async () => {
    if (!selected) return;
    setDebugging(true);
    setTab('output');
    try {
      const result = await onDebug(selected.id);
      setDebugResult(result);
      if (result.status === 'success') message.success('调试成功');
      else message.error(result.error || '调试失败');
    } catch (err: any) {
      message.error(err?.message || '调试失败');
    } finally {
      setDebugging(false);
    }
  };

  if (!selected) {
    return (
      <aside className="afe-props">
        <div className="afe-props-head">
          <h3>属性</h3>
        </div>
        <div className="afe-props-empty">
          <p>单击画布中的节点查看并编辑参数。</p>
          <p className="afe-dim">从左侧拖入节点开始编排。</p>
        </div>
      </aside>
    );
  }

  const meta = NODE_META[selected.data.type];
  const labelInvalid = labelDraft.trim() !== '' && !isVariableSafeLabel(labelDraft.trim());

  return (
    <aside className="afe-props" onFocusCapture={beginHistory}>
      <div className="afe-props-head">
        <span className="afe-nbar" style={{ background: meta.color }} />
        <input
          className="afe-input afe-title-input"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          title="节点名称（变量引用使用该名称）"
        />
        <button className="afe-btn afe-btn--text" onClick={handleDebug} disabled={debugging}>
          {debugging ? '调试中…' : '调试此节点'}
        </button>
      </div>

      {labelInvalid && (
        <div className="afe-props-warn">名称含空格或特殊字符，无法作为变量引用源</div>
      )}

      <div className="afe-props-tabs">
        <button
          type="button"
          className={tab === 'params' ? 'afe-tab afe-tab--on' : 'afe-tab'}
          onClick={() => setTab('params')}
        >
          参数
        </button>
        <button
          type="button"
          className={tab === 'output' ? 'afe-tab afe-tab--on' : 'afe-tab'}
          onClick={() => setTab('output')}
        >
          输出
        </button>
        <span className="afe-dim" style={{ marginLeft: 'auto' }}>
          {meta.label}
        </span>
      </div>

      <div className="afe-props-body">
        {tab === 'params' ? (
          <>
            {/* 通用设置 */}
            <div className="afe-props-group">
              <div className="afe-props-group-title">基本</div>
              <Field label="启用">
                <button
                  type="button"
                  aria-pressed={draft.enabled !== false}
                  className={
                    draft.enabled === false
                      ? 'afe-switch'
                      : 'afe-switch afe-switch--on'
                  }
                  onClick={() => {
                    beginHistory();
                    setField('enabled', draft.enabled === false);
                  }}
                />
              </Field>
              <div className="afe-field-row">
                <Field label="失败重试（0-3）">
                  <input
                    className="afe-input"
                    type="number"
                    min={0}
                    max={3}
                    value={draft.retry ?? 0}
                    onChange={(e) => setField('retry', Number(e.target.value))}
                  />
                </Field>
                <Field label="超时（秒）">
                  <input
                    className="afe-input"
                    type="number"
                    min={1}
                    value={draft.timeout_s ?? 120}
                    onChange={(e) => setField('timeout_s', Number(e.target.value))}
                  />
                </Field>
              </div>
              <Field label="备注">
                <textarea
                  className="afe-textarea"
                  rows={2}
                  value={draft.notes ?? ''}
                  onChange={(e) => setField('notes', e.target.value)}
                />
              </Field>
            </div>

            {/* 输入 */}
            {selected.data.type === 'input' && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">输入字段</div>
                <Field label="字段名" hint="运行表单与变量引用使用该字段名">
                  <input
                    className="afe-input"
                    value={draft.key ?? ''}
                    onChange={(e) => setField('key', e.target.value)}
                  />
                </Field>
                <Field label="类型">
                  <select
                    className="afe-select"
                    value={draft.data_type ?? 'text'}
                    onChange={(e) => setField('data_type', e.target.value)}
                  >
                    <option value="text">文本</option>
                    <option value="number">数字</option>
                    <option value="bool">布尔</option>
                    <option value="json">JSON</option>
                  </select>
                </Field>
                <Field label="必填">
                  <button
                    type="button"
                    aria-pressed={Boolean(draft.required)}
                    className={draft.required ? 'afe-switch afe-switch--on' : 'afe-switch'}
                    onClick={() => {
                      beginHistory();
                      setField('required', !draft.required);
                    }}
                  />
                </Field>
                <Field label="默认值">
                  <input
                    className="afe-input"
                    value={draft.default ?? ''}
                    onChange={(e) => setField('default', e.target.value)}
                  />
                </Field>
                <Field label="说明">
                  <textarea
                    className="afe-textarea"
                    rows={2}
                    value={draft.description ?? ''}
                    onChange={(e) => setField('description', e.target.value)}
                  />
                </Field>
              </div>
            )}

            {/* LLM / 抽取 */}
            {(selected.data.type === 'llm' || selected.data.type === 'extract') && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">模型</div>
                <Field label="服务商">
                  <select
                    className="afe-select"
                    value={draft.provider_id ?? ''}
                    onChange={(e) => setField('provider_id', e.target.value)}
                  >
                    <option value="">（未选择）</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.kind}
                      </option>
                    ))}
                  </select>
                </Field>
                {providers.length === 0 && (
                  <div className="afe-hint">
                    尚未配置服务商，<Link to="/models">前往模型配置</Link>
                  </div>
                )}
                <Field label="模型名">
                  <input
                    className="afe-input"
                    placeholder={providers.find((p) => p.id === draft.provider_id)?.default_model || '如 gpt-4o-mini'}
                    value={draft.model ?? ''}
                    onChange={(e) => setField('model', e.target.value)}
                  />
                </Field>

                {selected.data.type === 'llm' ? (
                  <>
                    <Field label="系统提示">
                      <textarea
                        ref={register('system')}
                        className="afe-textarea"
                        rows={3}
                        value={draft.system ?? ''}
                        onChange={(e) => setField('system', e.target.value)}
                      />
                      {renderVariables('system')}
                    </Field>
                    <Field label="用户提示">
                      <textarea
                        ref={register('prompt')}
                        className="afe-textarea"
                        rows={4}
                        value={draft.prompt ?? ''}
                        onChange={(e) => setField('prompt', e.target.value)}
                      />
                      {renderVariables('prompt')}
                    </Field>
                    <div className="afe-field-row">
                      <Field label="温度">
                        <input
                          className="afe-input"
                          type="number"
                          step={0.1}
                          min={0}
                          max={2}
                          value={draft.temperature ?? 0.7}
                          onChange={(e) => setField('temperature', Number(e.target.value))}
                        />
                      </Field>
                      <Field label="最大 tokens">
                        <input
                          className="afe-input"
                          type="number"
                          min={1}
                          value={draft.max_tokens ?? 2048}
                          onChange={(e) => setField('max_tokens', Number(e.target.value))}
                        />
                      </Field>
                    </div>
                    <Field label="输出格式">
                      <select
                        className="afe-select"
                        value={draft.format ?? 'text'}
                        onChange={(e) => setField('format', e.target.value)}
                      >
                        <option value="text">文本</option>
                        <option value="json">JSON</option>
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="待抽取内容">
                      <textarea
                        ref={register('prompt')}
                        className="afe-textarea"
                        rows={4}
                        value={draft.prompt ?? ''}
                        onChange={(e) => setField('prompt', e.target.value)}
                      />
                      {renderVariables('prompt')}
                    </Field>
                    <Field label="目标字段" hint="每行一个：字段名: 说明">
                      <textarea
                        className="afe-textarea"
                        rows={4}
                        placeholder={'sentiment: 情感倾向\nkeywords: 关键词'}
                        value={draft.fields_text ?? ''}
                        onChange={(e) => setField('fields_text', e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
            )}

            {/* HTTP */}
            {selected.data.type === 'http' && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">请求</div>
                <div className="afe-field-row">
                  <Field label="方法">
                    <select
                      className="afe-select"
                      value={draft.method ?? 'GET'}
                      onChange={(e) => setField('method', e.target.value)}
                    >
                      {['GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="超时（秒）">
                    <input
                      className="afe-input"
                      type="number"
                      min={1}
                      value={draft.timeout_s ?? 30}
                      onChange={(e) => setField('timeout_s', Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Field label="地址">
                  <input
                    ref={register('url')}
                    className="afe-input"
                    placeholder="https://api.example.com/data"
                    value={draft.url ?? ''}
                    onChange={(e) => setField('url', e.target.value)}
                  />
                  {renderVariables('url')}
                </Field>
                <Field label="请求头" hint="JSON 对象">
                  <textarea
                    className="afe-textarea"
                    rows={3}
                    value={draft.headers ?? '{}'}
                    onChange={(e) => setField('headers', e.target.value)}
                  />
                </Field>
                <Field label="请求体">
                  <textarea
                    ref={register('body')}
                    className="afe-textarea"
                    rows={4}
                    value={draft.body ?? ''}
                    onChange={(e) => setField('body', e.target.value)}
                  />
                  {renderVariables('body')}
                </Field>
              </div>
            )}

            {/* Python */}
            {selected.data.type === 'python' && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">脚本</div>
                <Field
                  label="脚本内容"
                  hint="输入数据：data['inputs'] / data['upstream']；输出写入 agentflow_result"
                >
                  <textarea
                    className="afe-textarea afe-code"
                    rows={12}
                    spellCheck={false}
                    value={draft.script ?? ''}
                    onChange={(e) => setField('script', e.target.value)}
                  />
                </Field>
                <Field label="超时（秒）">
                  <input
                    className="afe-input"
                    type="number"
                    min={1}
                    value={draft.timeout_s ?? 60}
                    onChange={(e) => setField('timeout_s', Number(e.target.value))}
                  />
                </Field>
              </div>
            )}

            {/* 条件 */}
            {selected.data.type === 'condition' && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">比较</div>
                <Field label="左值">
                  <input
                    ref={register('left')}
                    className="afe-input"
                    placeholder="{{ 上游节点.字段 }}"
                    value={draft.left ?? ''}
                    onChange={(e) => setField('left', e.target.value)}
                  />
                  {renderVariables('left')}
                </Field>
                <Field label="比较符">
                  <select
                    className="afe-select"
                    value={draft.op ?? 'eq'}
                    onChange={(e) => setField('op', e.target.value)}
                  >
                    {CONDITION_OPS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="右值">
                  <input
                    ref={register('right')}
                    className="afe-input"
                    value={draft.right ?? ''}
                    onChange={(e) => setField('right', e.target.value)}
                  />
                  {renderVariables('right')}
                </Field>
              </div>
            )}

            {/* 合并 */}
            {selected.data.type === 'merge' && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">合并</div>
                <Field label="合并策略">
                  <select
                    className="afe-select"
                    value={draft.strategy ?? 'all'}
                    onChange={(e) => setField('strategy', e.target.value)}
                  >
                    <option value="all">全部到达</option>
                    <option value="any">任一到达</option>
                  </select>
                </Field>
                <Field label="结果字段名">
                  <input
                    className="afe-input"
                    value={draft.field ?? 'merged'}
                    onChange={(e) => setField('field', e.target.value)}
                  />
                </Field>
              </div>
            )}

            {/* 输出 */}
            {selected.data.type === 'output' && (
              <div className="afe-props-group">
                <div className="afe-props-group-title">结果</div>
                <Field label="结果字段名">
                  <input
                    className="afe-input"
                    value={draft.field ?? 'result'}
                    onChange={(e) => setField('field', e.target.value)}
                  />
                </Field>
                <Field label="来源变量">
                  <textarea
                    ref={register('source')}
                    className="afe-textarea"
                    rows={3}
                    placeholder="{{ 上游节点.字段 }}"
                    value={draft.source ?? ''}
                    onChange={(e) => setField('source', e.target.value)}
                  />
                  {renderVariables('source')}
                </Field>
                <Field label="展示格式">
                  <select
                    className="afe-select"
                    value={draft.format ?? 'text'}
                    onChange={(e) => setField('format', e.target.value)}
                  >
                    <option value="text">文本</option>
                    <option value="json">JSON</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </Field>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="afe-props-group">
              <div className="afe-props-group-title">最近一次运行输出</div>
              <pre className="afe-output-json">
                {pretty(latestOutputs[selected.id])}
              </pre>
            </div>

            <div className="afe-props-group">
              <div className="afe-props-group-title">调试结果</div>
              {debugResult ? (
                <>
                  <div className="afe-debug-meta">
                    <span className={`afe-log-${debugResult.status === 'success' ? 'ok' : 'fail'}`}>
                      {debugResult.status}
                    </span>
                    <span>{debugResult.duration_ms}ms</span>
                    {debugResult.tokens_in || debugResult.tokens_out ? (
                      <span>
                        {debugResult.tokens_in}→{debugResult.tokens_out} tokens
                      </span>
                    ) : null}
                    {debugResult.model ? <span>{debugResult.model}</span> : null}
                  </div>
                  {debugResult.error && (
                    <div className="afe-debug-error">{debugResult.error}</div>
                  )}
                  <pre className="afe-output-json">{pretty(debugResult.output)}</pre>
                </>
              ) : (
                <div className="afe-hint">点击右上角「调试此节点」查看结果（不写入运行记录）</div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
