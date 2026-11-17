import { Alert, App, Button, Input, Modal, Segmented, Tag } from 'antd';
import { useEffect, useState } from 'react';

import {
  createProviderForOnboarding,
  createWorkflow,
  getRunStatus,
  runWorkflow,
  testProviderForOnboarding,
  type ProviderCreate,
} from '../api';
import { WORKFLOW_TEMPLATES, getTemplate } from '../templates';
import './OnboardingWizard.css';

interface Props {
  open: boolean;
  onClose: (done: boolean) => void;
  onOpenWorkflow: (workflowId: string) => void;
}

const KINDS: { value: ProviderCreate['kind']; label: string; hint: string }[] = [
  { value: 'openai-compat', label: 'OpenAI 兼容', hint: 'GPT / DeepSeek / 通义等' },
  { value: 'ollama', label: 'Ollama 本地', hint: '无需 Key，本机运行' },
  { value: 'anthropic-compat', label: 'Anthropic 兼容', hint: 'Claude 系列' },
];

const DEFAULTS: Record<string, { base_url: string; default_model: string }> = {
  'openai-compat': { base_url: 'https://api.deepseek.com/v1', default_model: 'deepseek-flash' },
  ollama: { base_url: 'http://localhost:11434', default_model: 'qwen2.5:7b' },
  'anthropic-compat': {
    base_url: 'https://api.anthropic.com',
    default_model: 'claude-3-5-sonnet-latest',
  },
};

const SAMPLE_INPUTS: Record<string, unknown> = {
  text: 'Agenza 是一个本地 AI 工作流工具：过程可见、可复盘。',
  url: 'https://example.com',
  payload: '[1, null, 2, "a"]',
};

/** 首次引导（F4/T5.3.8）：配置服务商 → 选模板 → 跑通一个示例。 */
export default function OnboardingWizard({ open, onClose, onOpenWorkflow }: Props) {
  const { message } = App.useApp();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ProviderCreate['kind']>('openai-compat');
  const [form, setForm] = useState({
    name: '我的模型服务',
    base_url: DEFAULTS['openai-compat'].base_url,
    api_key: '',
    default_model: DEFAULTS['openai-compat'].default_model,
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [templateKey, setTemplateKey] = useState('python-transform');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setRunError(null);
    setCreatedId(null);
    setFinished(false);
    setRunning(false);
  }, [open]);

  const changeKind = (value: ProviderCreate['kind']) => {
    setKind(value);
    setForm((prev) => ({
      ...prev,
      base_url: DEFAULTS[value].base_url,
      default_model: DEFAULTS[value].default_model,
      api_key: value === 'ollama' ? '' : prev.api_key,
    }));
  };

  const providerBody = (): ProviderCreate => ({
    kind,
    name: form.name.trim() || '我的模型服务',
    base_url: form.base_url.trim(),
    api_key: kind === 'ollama' ? null : form.api_key.trim() || null,
    default_model: form.default_model.trim() || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await testProviderForOnboarding(providerBody());
      if (result.ok) message.success(`连接成功${result.model ? `（${result.model}）` : ''}`);
      else message.error(`连接失败：${result.message}`);
    } catch (err: any) {
      message.error(err?.message || '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSaveProvider = async () => {
    if (!form.base_url.trim()) {
      message.error('请填写服务地址');
      return;
    }
    setSaving(true);
    try {
      await createProviderForOnboarding(providerBody());
      setProviderReady(true);
      setTemplateKey('summary-llm');
      setStep(1);
    } catch (err: any) {
      message.error(err?.message || '保存服务商失败');
    } finally {
      setSaving(false);
    }
  };

  const allowedTemplate = (key: string) => {
    const template = getTemplate(key);
    return Boolean(template) && (!template?.needsProvider || providerReady);
  };

  const startSampleRun = async () => {
    const template = getTemplate(templateKey);
    if (!template) return;
    setRunning(true);
    setRunError(null);
    try {
      const graph = template.build();
      const workflow = await createWorkflow({
        name: `${template.name} · 示例`,
        description: template.description,
        graph,
      });
      setCreatedId(workflow.id);

      const inputs: Record<string, unknown> = {};
      for (const field of graph.inputs ?? []) {
        inputs[field.key] = SAMPLE_INPUTS[field.key] ?? field.default ?? '示例输入';
      }

      const run = await runWorkflow(workflow.id, inputs);
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const detail = await getRunStatus(run.id);
        if (detail.status !== 'running') {
          if (detail.status === 'success') {
            setFinished(true);
            setStep(2);
          } else {
            setRunError(detail.error || '示例运行失败');
            setStep(2);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setRunError('示例运行超时，请到编辑器里手动运行');
      setStep(2);
    } catch (err: any) {
      setRunError(err?.message || '创建示例失败');
      setStep(2);
    } finally {
      setRunning(false);
    }
  };

  const close = (done: boolean) => {
    onClose(done);
  };

  return (
    <Modal
      open={open}
      footer={null}
      closable={false}
      width={620}
      onCancel={() => close(true)}
      destroyOnHidden
      className="afe-onb-modal"
    >
      <div className="afe-onb">
        <div className="afe-onb-head">
          <h2>开始使用 Agenza</h2>
          <button type="button" className="afe-onb-skip" onClick={() => close(true)}>
            跳过
          </button>
        </div>
        <div className="afe-onb-steps">
          <span className={step >= 0 ? 'on' : ''} />
          <span className={step >= 1 ? 'on' : ''} />
          <span className={step >= 2 ? 'on' : ''} />
        </div>

        {step === 0 && (
          <>
            <div className="afe-onb-title">第 1 步 / 3 · 配置模型服务商</div>
            <Segmented
              block
              value={kind}
              onChange={(value) => changeKind(value as ProviderCreate['kind'])}
              options={KINDS.map((item) => ({ label: item.label, value: item.value }))}
            />
            <div className="afe-onb-hint">{KINDS.find((item) => item.value === kind)?.hint}</div>

            <div className="afe-onb-field">
              <label>名称</label>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="afe-onb-field">
              <label>服务地址</label>
              <Input
                value={form.base_url}
                onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))}
              />
            </div>
            {kind !== 'ollama' && (
              <div className="afe-onb-field">
                <label>API Key</label>
                <Input.Password
                  value={form.api_key}
                  placeholder="本地保存时会加密"
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, api_key: event.target.value }))
                  }
                />
              </div>
            )}
            <div className="afe-onb-field">
              <label>默认模型</label>
              <Input
                value={form.default_model}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, default_model: event.target.value }))
                }
              />
            </div>

            <div className="afe-onb-foot">
              <Button onClick={() => close(true)}>跳过</Button>
              <div className="afe-onb-foot-right">
                <Button loading={testing} onClick={() => void handleTest()}>
                  测试连接
                </Button>
                <Button type="primary" loading={saving} onClick={() => void handleSaveProvider()}>
                  保存并继续
                </Button>
              </div>
            </div>
            <button type="button" className="afe-onb-link" onClick={() => setStep(1)}>
              先不配置模型，用「无需模型」的模板体验
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <div className="afe-onb-title">第 2 步 / 3 · 选择一个模板</div>
            <div className="afe-onb-templates">
              {WORKFLOW_TEMPLATES.slice(0, 6).map((template) => {
                const allowed = allowedTemplate(template.key);
                return (
                  <button
                    type="button"
                    key={template.key}
                    disabled={!allowed}
                    className={`afe-onb-tpl${templateKey === template.key ? ' on' : ''}`}
                    onClick={() => setTemplateKey(template.key)}
                  >
                    <div className="afe-onb-tpl-name">{template.name}</div>
                    <div className="afe-onb-tpl-desc">{template.description}</div>
                    <div className="afe-onb-tpl-meta">
                      <Tag color={template.needsProvider ? 'blue' : 'green'}>
                        {template.needsProvider ? '需要模型' : '无需模型'}
                      </Tag>
                      {!allowed && <span className="afe-onb-lock">需先配置模型</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="afe-onb-foot">
              <Button onClick={() => setStep(0)}>上一步</Button>
              <div className="afe-onb-foot-right">
                <Button type="primary" loading={running} onClick={() => void startSampleRun()}>
                  创建并运行示例
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="afe-onb-title">第 3 步 / 3 · 示例运行</div>
            {finished ? (
              <Alert
                type="success"
                showIcon
                message="示例运行成功"
                description="你已经完成了一次完整流程。接下来可以改节点、换成自己的输入，或在「模型配置」里补充更多服务商。"
              />
            ) : (
              <Alert
                type="error"
                showIcon
                message="示例运行未通过"
                description={runError || '请打开编辑器查看具体原因。'}
              />
            )}
            <div className="afe-onb-foot">
              <Button onClick={() => close(true)}>稍后再说</Button>
              <div className="afe-onb-foot-right">
                {createdId && (
                  <Button
                    type="primary"
                    onClick={() => {
                      close(true);
                      onOpenWorkflow(createdId);
                    }}
                  >
                    打开编辑器
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
