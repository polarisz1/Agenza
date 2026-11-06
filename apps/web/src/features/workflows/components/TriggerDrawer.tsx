import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Switch,
  Tag,
} from 'antd';
import { ArrowsClockwise, CopySimple, Plus, Trash, WebhooksLogo } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { CodeBlock } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils/datetime';
import {
  createWebhookTrigger,
  deleteWebhookTrigger,
  listWebhookTriggers,
  rotateWebhookTriggerSecret,
  updateWebhookTrigger,
  type WebhookTriggerCreated,
  type WebhookTriggerItem,
} from '../api';
import './TriggerDrawer.css';

interface Props {
  open: boolean;
  workflowId: string | null;
  onClose: () => void;
}

interface TriggerFormValues {
  name: string;
  enabled: boolean;
  mapping?: { key?: string; path?: string }[];
}

interface SecretState {
  trigger: WebhookTriggerCreated;
  mode: 'created' | 'rotated';
}

/** 公网可访问的 Webhook 地址：Electron 分端口时用 API 绝对地址，其余按当前站点拼接 */
function absoluteWebhook(path: string): string {
  const base = import.meta.env.VITE_API_BASE_URL || '';
  if (/^https?:\/\//i.test(base)) return `${base.replace(/\/+$/, '')}${path}`;
  return `${window.location.origin}${path}`;
}

function webhookCurl(url: string): string {
  return `TS=$(date +%s)
SECRET='<webhook-secret>'
BODY='{"event":{"text":"hello"}}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST '${url}' \\
  -H "X-AgentFlow-Timestamp: $TS" \\
  -H "X-AgentFlow-Signature: sha256=$SIG" \\
  -H 'Content-Type: application/json' \\
  -d "$BODY"`;
}

export default function TriggerDrawer({ open, workflowId, onClose }: Props) {
  const { message, modal } = App.useApp();
  const [triggers, setTriggers] = useState<WebhookTriggerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [secretState, setSecretState] = useState<SecretState | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form] = Form.useForm<TriggerFormValues>();

  const load = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      setTriggers(await listWebhookTriggers(workflowId));
    } catch (err: any) {
      setError(err?.message || '加载触发器失败');
      setTriggers([]);
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => message.success('已复制'))
      .catch(() => message.error('复制失败，请手动选择文本'));
  };

  const openCreate = () => {
    form.resetFields();
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (!workflowId) return;
    let values: TriggerFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const mapping: Record<string, string> = {};
    for (const row of values.mapping ?? []) {
      const key = (row?.key || '').trim();
      const path = (row?.path || '').trim();
      if (key && path) mapping[key] = path;
    }

    setCreating(true);
    try {
      const created = await createWebhookTrigger({
        workflow_id: workflowId,
        name: values.name.trim(),
        enabled: values.enabled,
        input_mapping: Object.keys(mapping).length ? mapping : null,
      });
      setCreateOpen(false);
      form.resetFields();
      setSecretState({ trigger: created, mode: 'created' });
      await load();
    } catch (err: any) {
      message.error(err?.message || '创建触发器失败');
    } finally {
      setCreating(false);
    }
  };

  const toggle = async (trigger: WebhookTriggerItem, enabled: boolean) => {
    setTogglingId(trigger.id);
    try {
      const updated = await updateWebhookTrigger(trigger.id, { enabled });
      setTriggers((prev) => prev.map((item) => (item.id === trigger.id ? updated : item)));
      message.success(enabled ? '已启用' : '已停用');
    } catch (err: any) {
      message.error(err?.message || '更新触发器失败');
    } finally {
      setTogglingId(null);
    }
  };

  const rotate = (trigger: WebhookTriggerItem) => {
    modal.confirm({
      title: `轮换「${trigger.name}」的 Secret？`,
      content: '旧 Secret 会立即失效，所有调用方都需要同步更新；新 Secret 只显示一次。',
      okText: '轮换',
      okButtonProps: { danger: true },
      onOk: async () => {
        setRotatingId(trigger.id);
        try {
          const created = await rotateWebhookTriggerSecret(trigger.id);
          setSecretState({ trigger: created, mode: 'rotated' });
        } catch (err: any) {
          message.error(err?.message || '轮换 Secret 失败');
        } finally {
          setRotatingId(null);
        }
      },
    });
  };

  const remove = async (trigger: WebhookTriggerItem) => {
    setDeletingId(trigger.id);
    try {
      await deleteWebhookTrigger(trigger.id);
      message.success('已删除');
      await load();
    } catch (err: any) {
      message.error(err?.message || '删除触发器失败');
    } finally {
      setDeletingId(null);
    }
  };

  const secretUrl = secretState ? absoluteWebhook(secretState.trigger.webhook_path) : '';
  const secretCurl = secretState
    ? webhookCurl(secretUrl).replace('<webhook-secret>', secretState.trigger.secret)
    : '';

  return (
    <>
      <Drawer
        title={
          <span className="afe-trig-title">
            <WebhooksLogo size={16} /> Webhook 触发器
          </span>
        }
        placement="right"
        width={480}
        open={open}
        onClose={onClose}
        className="afe-trig-drawer"
      >
        <Alert
          type="info"
          showIcon
          message="通过 HMAC-SHA256 签名触发已发布工作流"
          description="请求需携带 X-AgentFlow-Timestamp 与 X-AgentFlow-Signature；只触发已发布版本，触发后立即返回 run_id。"
        />

        <div className="afe-trig-toolbar">
          <span className="afe-trig-count">{triggers.length} 个触发器</span>
          <Button
            type="primary"
            size="small"
            icon={<Plus size={13} />}
            disabled={!workflowId}
            onClick={openCreate}
          >
            新建触发器
          </Button>
        </div>

        {loading ? (
          <div className="afe-trig-loading">
            <Spin />
          </div>
        ) : error ? (
          <Empty description={error}>
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          </Empty>
        ) : triggers.length === 0 ? (
          <Empty description="还没有 Webhook 触发器" />
        ) : (
          <div className="afe-trig-list">
            {triggers.map((trigger) => {
              const url = absoluteWebhook(trigger.webhook_path);
              return (
                <div className="afe-trig-item" key={trigger.id}>
                  <div className="afe-trig-head">
                    <span className="afe-trig-name">{trigger.name}</span>
                    <Tag color={trigger.enabled ? 'green' : 'default'}>
                      {trigger.enabled ? '已启用' : '已停用'}
                    </Tag>
                    <Switch
                      size="small"
                      checked={trigger.enabled}
                      loading={togglingId === trigger.id}
                      onChange={(checked) => void toggle(trigger, checked)}
                    />
                  </div>

                  <div className="afe-trig-url">
                    <code title={url}>{url}</code>
                    <Button
                      type="text"
                      size="small"
                      icon={<CopySimple size={13} />}
                      title="复制 Webhook URL"
                      onClick={() => copy(url)}
                    />
                  </div>

                  <div className="afe-trig-meta">
                    <span>最近触发：{formatDateTime(trigger.last_triggered_at)}</span>
                    <span>创建：{formatDateTime(trigger.created_at)}</span>
                  </div>

                  {trigger.input_mapping && Object.keys(trigger.input_mapping).length > 0 ? (
                    <div className="afe-trig-mapping">
                      输入映射：<code>{JSON.stringify(trigger.input_mapping)}</code>
                    </div>
                  ) : (
                    <div className="afe-trig-mapping">输入映射：整个请求体作为输入</div>
                  )}

                  <div className="afe-trig-actions">
                    <Button size="small" onClick={() => copy(webhookCurl(url))}>
                      复制 curl 示例
                    </Button>
                    <Button
                      size="small"
                      icon={<ArrowsClockwise size={13} />}
                      loading={rotatingId === trigger.id}
                      onClick={() => rotate(trigger)}
                    >
                      轮换 Secret
                    </Button>
                    <Popconfirm
                      title="删除这个触发器？"
                      description="删除后 Webhook 地址立即失效，且不可恢复。"
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void remove(trigger)}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<Trash size={13} />}
                        loading={deletingId === trigger.id}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Drawer>

      <Modal
        title="新建 Webhook 触发器"
        open={createOpen}
        width={620}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ enabled: true, mapping: [] }}>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入触发器名称' },
              { max: 100, message: '名称不能超过 100 个字符' },
            ]}
          >
            <Input placeholder="例如：GitHub Push" maxLength={100} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>

          <div className="afe-trig-field-label">输入映射（可选）</div>
          <div className="afe-trig-help">
            key 是工作流输入变量名；value 以 <code>$</code> 开头时按 JSONPath 提取（如{' '}
            <code>$.event.text</code>），否则按字面量处理。不配置时整个 JSON 请求体作为输入。
          </div>
          <Form.List name="mapping">
            {(fields, { add, remove: removeRow }) => (
              <div className="afe-trig-mapping-list">
                {fields.map((field) => (
                  <div className="afe-trig-mapping-row" key={field.key}>
                    <Form.Item
                      name={[field.name, 'key']}
                      rules={[{ required: true, message: '请输入变量名' }]}
                      noStyle
                    >
                      <Input placeholder="变量名，如 text" />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'path']}
                      rules={[{ required: true, message: '请输入取值路径' }]}
                      noStyle
                    >
                      <Input placeholder="$.event.text 或固定值" />
                    </Form.Item>
                    <Button
                      type="text"
                      icon={<Trash size={14} />}
                      aria-label="删除映射"
                      onClick={() => removeRow(field.name)}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  icon={<Plus size={13} />}
                  onClick={() => add({ key: '', path: '' })}
                >
                  添加映射
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title={secretState?.mode === 'rotated' ? 'Secret 已轮换' : '触发器已创建'}
        open={secretState !== null}
        width={680}
        closable={false}
        maskClosable={false}
        footer={
          <Button type="primary" onClick={() => setSecretState(null)}>
            我已保存，关闭
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          message="请立即复制并妥善保存 Secret"
          description="Secret 只显示这一次；轮换后旧 Secret 立即失效，调用方需要同步更新。"
        />

        <div className="afe-trig-field-label">Webhook URL</div>
        <Input
          readOnly
          value={secretUrl}
          className="af-mono"
          addonAfter={
            <Button
              type="text"
              size="small"
              icon={<CopySimple size={13} />}
              onClick={() => copy(secretUrl)}
            >
              复制
            </Button>
          }
        />

        <div className="afe-trig-field-label">Secret</div>
        <Input
          readOnly
          value={secretState?.trigger.secret}
          className="af-mono"
          addonAfter={
            <Button
              type="text"
              size="small"
              icon={<CopySimple size={13} />}
              onClick={() => secretState && copy(secretState.trigger.secret)}
            >
              复制
            </Button>
          }
        />

        <div className="afe-trig-field-label">curl 示例（需要 openssl）</div>
        <CodeBlock code={secretCurl} />
      </Modal>
    </>
  );
}
