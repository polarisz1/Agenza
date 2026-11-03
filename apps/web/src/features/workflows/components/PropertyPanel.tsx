import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { App, AutoComplete, Button, Input, Segmented, Switch } from 'antd';

import { CONDITION_OPS, NODE_META, isVariableSafeLabel } from '../types';
import {
  listProviderModels,
  listProviderOptions,
  type NodeTestResult,
  type ProviderOption,
} from '../api';
import { registerDraftFlusher } from '../hooks/draftBridge';
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
  const { message } = App.useApp();
  const nodes = useEditorStore((s) => s.nodes);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelection = useEditorStore((s) => s.duplicateSelection);
  const toggleSelectedEnabled = useEditorStore((s) => s.toggleSelectedEnabled);
  const description = useEditorStore((s) => s.description);
  const setDescription = useEditorStore((s) => s.setDescription);
  const historyVersion = useEditorStore((s) => s.historyVersion);
  const beginHistory = useEditorStore((s) => s.beginHistory);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [labelDraft, setLabelDraft] = useState('');
  const [tab, setTab] = useState<'params' | 'output'>('params');
  const [debugging, setDebugging] = useState(false);
  const [debugResult, setDebugResult] = useState<NodeTestResult | null>(null);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  // F3：当前服务商的可用模型（失败时为空，仍允许手动输入）
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const refs = useRef<Record<string, FieldElement | null>>({});

  // 用 ref 保住"最新草稿 + 它属于哪个节点"，供切换节点/外部 flush 时立刻提交
  const draftRef = useRef<{ nodeId: string | null; config: Record<string, any>; label: string }>({
    nodeId: null,
    config: {},
    label: '',
  });

  /** 立刻把草稿写进 store（防抖还没到点也不会丢）。 */
  const commitDraft = useCallback(() => {
    const current = draftRef.current;
    if (!current.nodeId) return;
    const store = useEditorStore.getState();
    store.updateNodeConfig(current.nodeId, current.config);
    const node = store.nodes.find((n) => n.id === current.nodeId);
    const type = node?.data.type ?? 'python';
    store.updateLabel(current.nodeId, current.label.trim() || NODE_META[type].label);
  }, []);

  // 切换节点 / 撤销重做后，同步表单草稿
  useEffect(() => {
    if (!selected) {
      setDraft({});
      setLabelDraft('');
      setDebugResult(null);
      draftRef.current = { nodeId: null, config: {}, label: '' };
      return;
    }
    setDraft({ ...selected.data.config });
    setLabelDraft(selected.data.label);
    setDebugResult(null);
    setTab('params');
    draftRef.current = {
      nodeId: selected.id,
      config: { ...selected.data.config },
      label: selected.data.label,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, historyVersion]);

  // 切换节点时，先把上一个节点的草稿提交掉，避免最后几次输入被丢弃（F2）
  useEffect(() => {
    return () => {
      commitDraft();
    };
  }, [selectedId, commitDraft]);

  // 让画布侧（校验/运行/调试/返回列表前）能立刻提交草稿
  useEffect(() => {
    registerDraftFlusher(commitDraft);
    return () => registerDraftFlusher(null);
  }, [commitDraft]);

  // 参数输入 300ms 防抖提交到 store
  useEffect(() => {
    if (!selectedId) return;
    draftRef.current = { ...draftRef.current, nodeId: selectedId, config: draft };
    const timer = window.setTimeout(commitDraft, 300);
    return () => window.clearTimeout(timer);
  }, [draft, selectedId, commitDraft]);

  // 名称同样防抖
  useEffect(() => {
    if (!selectedId) return;
    draftRef.current = { ...draftRef.current, nodeId: selectedId, label: labelDraft };
    const timer = window.setTimeout(commitDraft, 300);
    return () => window.clearTimeout(timer);
  }, [labelDraft, selectedId, commitDraft]);

  useEffect(() => {
    listProviderOptions()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  const refreshModels = useCallback(async (providerId?: string) => {
    if (!providerId) {
      setModels([]);
      return;
    }
    setModelsLoading(true);
    try {
      setModels(await listProviderModels(providerId));
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const draftProviderId =
    selected && (selected.data.type === 'llm' || selected.data.type === 'extract')
      ? String(selected.data.config?.provider_id || '')
      : '';

  useEffect(() => {
    if (!draftProviderId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    listProviderModels(draftProviderId)
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftProviderId]);

  const setField = (key: string, value: unknown) => setDraft((prev) => ({ ...prev, [key]: value }));

  const register =
    (field: string): FieldRef =>
    (el) => {
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
      return <div className="afe-hint">暂无可用变量 · 先连上游节点</div>;
    }
    return (
      <div className="afe-vars-line">
        <span className="afe-vars-line-label">可用变量：</span>
        {variables.map((v) => (
          <button
            type="button"
            key={v.token}
            className="afe-var-chip"
            title={`插入「${v.token}」到「${field}」`}
            onClick={() => insertToken(field, v.token)}
          >
            <span className="afe-var-chip-label">{v.nodeLabel}</span>
            {v.field && <span className="afe-var-chip-field">.{v.field}</span>}
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

  if (selectedIds.length > 1) {
    return (
      <aside className="afe-props">
        <div className="afe-props-head">
          <h3>批量操作</h3>
        </div>
        <div className="afe-props-empty">
          <p>已选中 {selectedIds.length} 个节点</p>
          <p className="afe-dim">可以一起移动、复制、启用/禁用或删除；按 Esc 取消选择。</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Button size="small" onClick={duplicateSelection}>
              复制
            </Button>
            <Button size="small" onClick={toggleSelectedEnabled}>
              启用 / 禁用
            </Button>
            <Button size="small" danger onClick={deleteSelected}>
              删除
            </Button>
          </div>
        </div>
      </aside>
    );
  }

  if (!selected) {
    return (
      <aside className="afe-props">
        <div className="afe-props-head">
          <h3>属性</h3>
        </div>
        <div className="afe-props-empty">
          <p>单击画布中的节点查看并编辑参数。</p>
          <p className="afe-dim">从左侧拖入节点开始编排。</p>

          {/* 工作流级信息：没选中节点时编辑，列表页的「描述」列才有内容（评审 G28） */}
          <div className="afe-props-group" style={{ marginTop: 18 }}>
            <div className="afe-props-group-title">工作流信息</div>
            <Field label="描述" hint="保存后显示在工作流列表的「描述」列">
              <Input.TextArea
                rows={3}
                value={description}
                placeholder="例如：抓取网页并用 LLM 摘要"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
        </div>
      </aside>
    );
  }

  const meta = NODE_META[selected.data.type];
  const labelInvalid = labelDraft.trim() !== '' && !isVariableSafeLabel(labelDraft.trim());

  return (
    // 撤销点由 store 在"值真的变化时"按节点压入（F9），不再靠聚焦事件
    <aside className="afe-props">
      <div className="afe-props-head">
        <span className="afe-nbar" style={{ background: meta.color }} />
        <input
          className="afe-input afe-title-input"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          title="节点名称（变量引用使用该名称）"
        />
        <Button size="small" onClick={handleDebug} loading={debugging}>
          调试此节点
        </Button>
      </div>

      {labelInvalid && (
        <div className="afe-props-warn">名称含空格或特殊字符，无法作为变量引用源</div>
      )}

      <div className="afe-props-tabs">
        <Segmented
          size="small"
          value={tab}
          onChange={(value) => setTab(value as 'params' | 'output')}
          options={[
            { label: '参数', value: 'params' },
            { label: '输出', value: 'output' },
          ]}
        />
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
                <Switch
                  size="small"
                  checked={draft.enabled !== false}
                  onChange={(checked) => {
                    beginHistory();
                    setField('enabled', checked);
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
              <Field label="备注" hint="仅用于自己记录，不参与运行逻辑">
                <textarea
                  className="afe-textarea"
                  rows={2}
                  placeholder="例如：给 LLM 的提示词要包含角色设定……"
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
                  <Switch
                    size="small"
                    checked={Boolean(draft.required)}
                    onChange={(checked) => {
                      beginHistory();
                      setField('required', checked);
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
                <Field
                  label="模型"
                  hint={
                    models.length
                      ? `${models.length} 个可用模型；也可以直接输入`
                      : '可手动输入模型名；选择服务商后会自动拉取'
                  }
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <AutoComplete
                      style={{ flex: 1 }}
                      value={draft.model ?? ''}
                      options={models.map((model) => ({ value: model }))}
                      placeholder={
                        providers.find((p) => p.id === draft.provider_id)?.default_model ||
                        '如 gpt-4o-mini'
                      }
                      filterOption={(input, option) =>
                        String(option?.value ?? '')
                          .toLowerCase()
                          .includes(input.toLowerCase())
                      }
                      onChange={(value) => setField('model', value)}
                    />
                    <Button
                      size="small"
                      loading={modelsLoading}
                      onClick={() => void refreshModels(String(draft.provider_id || ''))}
                      title="刷新模型列表"
                    >
                      刷新
                    </Button>
                  </div>
                </Field>

                {selected.data.type === 'llm' ? (
                  <>
                    <Field label="系统提示" hint="定义 LLM 的角色和行为，对所有用户请求生效">
                      <textarea
                        ref={register('system')}
                        className="afe-textarea"
                        rows={3}
                        placeholder="你是一位专业的文案编辑，擅长把技术文档转成通俗易懂的说明。"
                        value={draft.system ?? ''}
                        onChange={(e) => setField('system', e.target.value)}
                      />
                      {renderVariables('system')}
                    </Field>
                    <Field label="用户提示" hint="每次运行时实际发送给 LLM 的内容；可以用 {{ 变量 }} 引用上游节点输出">
                      <textarea
                        ref={register('prompt')}
                        className="afe-textarea"
                        rows={4}
                        placeholder={
                          '请帮我把下面这段内容写成社交媒体文案：\n\n' +
                          '{{ 上游节点名称.字段名 }}'
                        }
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
                    <Field label="待抽取内容" hint="可以直接输入文本，也可以用 {{ 上游节点 }} 引用上游输出">
                      <textarea
                        ref={register('prompt')}
                        className="afe-textarea"
                        rows={4}
                        placeholder={
                          '{{ 上游节点名称 }}\n\n或者直接粘贴需要抽取的原始文本……'
                        }
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
                <Field label="请求体" hint="JSON / 纯文本均可；可以用 {{ 变量 }} 嵌入上游数据">
                  <textarea
                    ref={register('body')}
                    className="afe-textarea"
                    rows={4}
                    placeholder={
                      '{\n  "content": "{{ 上游节点名称.字段名 }}",\n  "timestamp": "{{ 另一个节点 }}"\n}'
                    }
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
                <Field label="左值" hint="可以用 {{ 上游节点 }} 引用，也可以直接写固定值（如 true、5）">
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
                <Field
                  label="引用上游节点的结果"
                  hint={
                    '这里决定"本节点要把哪个上游结果展示给最终用户"。\n' +
                    '点下方的变量标签即可插入完整引用；也可以手写 {{ 节点名.字段名 }}。\n' +
                    '示例：{{ llm_summary }} 表示直接引用上游 LLM 节点的全部输出。'
                  }
                >
                  <textarea
                    ref={register('source')}
                    className="afe-textarea"
                    rows={3}
                    placeholder="{{ 点下方的变量标签快速插入，或手写 {{ 上游节点.字段 }} }}"
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
              <pre className="afe-output-json">{pretty(latestOutputs[selected.id])}</pre>
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
                  {debugResult.error && <div className="afe-debug-error">{debugResult.error}</div>}
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
