import { Alert, App, Button, Form, Input, InputNumber, Modal, Popconfirm, Table, Tag } from 'antd';
import { CopySimple, Key, Plus, Trash } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { CodeBlock, SectionHeader } from '@/shared/components/ui';
import { formatDateTime, parseServerTime } from '@/shared/utils/datetime';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  type ApiKeyCreateResponse,
  type ApiKeyItem,
} from '../api';

interface CreateFormValues {
  name: string;
  expires_days?: number | null;
}

interface Props {
  /** 仅工作空间 owner 可管理 API Key（后端同权限） */
  canManage: boolean;
}

function httpTriggerCurl(): string {
  return `curl -X POST 'http://127.0.0.1:8000/api/v1/triggers/http/<workflow_id>' \\
  -H 'X-API-Key: af_xxxxxxxx_xxxxxxxx' \\
  -H 'Idempotency-Key: demo-001' \\
  -H 'Content-Type: application/json' \\
  -d '{"inputs":{"text":"你好"}}'`;
}

function keyStatus(item: ApiKeyItem): { color: string; label: string } {
  if (!item.enabled) return { color: 'default', label: '已吊销' };
  const expires = parseServerTime(item.expires_at);
  if (expires && expires.getTime() <= Date.now()) return { color: 'red', label: '已过期' };
  return { color: 'green', label: '有效' };
}

export default function ApiKeysPanel({ canManage }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [form] = Form.useForm<CreateFormValues>();

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await listApiKeys());
    } catch (err: any) {
      setError(err?.message || '加载 API Key 失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = (text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => message.success('已复制'))
      .catch(() => message.error('复制失败，请手动选择文本'));
  };

  if (!canManage) {
    return (
      <Alert
        type="info"
        showIcon
        message="仅工作空间 Owner 可以管理 API Key"
        description="API Key 属于工作空间级凭据，用于外部系统触发已发布工作流。请联系 Owner 创建或吊销。"
      />
    );
  }

  const submitCreate = async () => {
    let values: CreateFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setCreating(true);
    try {
      const resp = await createApiKey({
        name: values.name.trim(),
        expires_days: values.expires_days ?? null,
      });
      setCreateOpen(false);
      form.resetFields();
      setCreated(resp);
      await load();
    } catch (err: any) {
      message.error(err?.message || '创建 API Key 失败');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (item: ApiKeyItem) => {
    setRevokingId(item.id);
    try {
      await revokeApiKey(item.id);
      message.success('已吊销');
      await load();
    } catch (err: any) {
      message.error(err?.message || '吊销失败');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <>
      <SectionHeader
        title="API 访问密钥"
        description="外部系统通过 X-API-Key 调用 POST /api/v1/triggers/http/{workflow_id} 触发已发布工作流"
        extra={
          <Button
            type="primary"
            size="small"
            icon={<Plus size={13} />}
            onClick={() => setCreateOpen(true)}
          >
            创建 API Key
          </Button>
        }
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载 API Key 失败"
          description={error}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      ) : null}

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        pagination={false}
        dataSource={items}
        locale={{ emptyText: '还没有 API Key，点击右上角创建' }}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            render: (value: string) => <span style={{ fontWeight: 500 }}>{value}</span>,
          },
          {
            title: 'Key 前缀',
            dataIndex: 'key_prefix',
            render: (value: string) => <code className="af-mono">{value}…</code>,
          },
          {
            title: '状态',
            dataIndex: 'enabled',
            width: 90,
            render: (_: boolean, record) => {
              const status = keyStatus(record);
              return <Tag color={status.color}>{status.label}</Tag>;
            },
          },
          {
            title: '最近使用',
            dataIndex: 'last_used_at',
            render: (value: string | null) => formatDateTime(value),
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            render: (value: string) => formatDateTime(value),
          },
          {
            title: '过期时间',
            dataIndex: 'expires_at',
            render: (value: string | null) => (value ? formatDateTime(value) : '永不过期'),
          },
          {
            title: '操作',
            width: 90,
            render: (_: unknown, record) => (
              <Popconfirm
                title="吊销这个 API Key？"
                description="使用该 Key 的外部调用会立即失效，且不可恢复。"
                okText="吊销"
                okButtonProps={{ danger: true }}
                onConfirm={() => void revoke(record)}
              >
                <Button
                  size="small"
                  danger
                  icon={<Trash size={13} />}
                  loading={revokingId === record.id}
                >
                  吊销
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <div className="af-settings__code-head">
        <span>HTTP 触发示例</span>
        <Button
          size="small"
          type="text"
          icon={<CopySimple size={13} />}
          onClick={() => copy(httpTriggerCurl())}
        >
          复制
        </Button>
      </div>
      <CodeBlock code={httpTriggerCurl()} />

      <Modal
        title="创建 API Key"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ expires_days: 90 }}>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入 API Key 名称' },
              { max: 100, message: '名称不能超过 100 个字符' },
            ]}
          >
            <Input placeholder="例如：Zapier 集成" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="expires_days"
            label="有效期（天，留空表示永久有效）"
            extra="建议为外部集成设置有效期，到期后需要重新创建。"
          >
            <InputNumber min={1} max={3650} style={{ width: '100%' }} placeholder="90" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="API Key 已创建"
        open={created !== null}
        closable={false}
        maskClosable={false}
        width={620}
        footer={
          <Button type="primary" onClick={() => setCreated(null)}>
            我已保存，关闭
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          message="请立即复制并妥善保存"
          description="出于安全考虑，明文密钥只显示这一次；关闭后无法再次查看。"
        />
        <div className="af-settings__field-label">API Key</div>
        <Input
          readOnly
          value={created?.raw_key}
          className="af-mono"
          addonAfter={
            <Button
              type="text"
              size="small"
              icon={<Key size={13} />}
              onClick={() => created && copy(created.raw_key)}
            >
              复制
            </Button>
          }
        />
        <div className="af-settings__hint">
          使用时放入请求头 <code>X-API-Key</code>；可为同一请求附加 <code>Idempotency-Key</code>{' '}
          避免重复触发。
        </div>
      </Modal>
    </>
  );
}
