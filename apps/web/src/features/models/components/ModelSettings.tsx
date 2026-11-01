import {
  Alert,
  App,
  Button,
  Table,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Popconfirm,
} from 'antd';
import { PlusOutlined, LinkOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';

import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  testProviderById,
} from '../api';
import type { ProviderResponse } from '../api';
import EmptyState from '@/shared/components/EmptyState';

const KINDS: { value: string; label: string }[] = [
  { value: 'openai-compat', label: 'OpenAI 兼容（GPT / DeepSeek 等）' },
  { value: 'ollama', label: 'Ollama 本地' },
  { value: 'anthropic-compat', label: 'Anthropic 兼容' },
];

export default function ModelSettings() {
  const { message } = App.useApp();
  const [items, setItems] = useState<ProviderResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listProviders();
      setItems(data);
    } catch (err: any) {
      // 与工作流列表/设置页同样的错误态：接口失败不能只留一张空表（G22 同类问题）
      setLoadError(err?.message || '加载服务商失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = useCallback(() => {
    setEditingId(null);
    form.resetFields();
    setOpen(true);
  }, [form]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>模型与密钥</div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加服务商
        </Button>
      </div>

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载服务商失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 1100 }}
        locale={{
          emptyText: loading ? (
            <span />
          ) : (
            <EmptyState
              title="还没有配置模型服务商"
              description="支持 OpenAI 兼容（DeepSeek 等）、Ollama 本地、Anthropic 兼容。"
              action={
                <Button type="primary" onClick={openCreate}>
                  添加服务商
                </Button>
              }
            />
          ),
        }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          {
            title: '类型',
            dataIndex: 'kind',
            render: (k) => <Tag>{KINDS.find((x) => x.value === k)?.label || k}</Tag>,
          },
          { title: '服务地址', dataIndex: 'base_url', ellipsis: true },
          { title: '默认模型', dataIndex: 'default_model' },
          { title: '密钥', dataIndex: 'api_key_masked', width: 160 },
          {
            title: '操作',
            key: 'ops',
            width: 220,
            render: (_, r) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  icon={<LinkOutlined />}
                  disabled={testing}
                  onClick={async () => {
                    setTesting(true);
                    try {
                      // 已保存的服务商按 id 测试：后端用库里解密的密钥，
                      // 前端不需要（也不应该）拿到明文（F5）
                      const res = await testProviderById(r.id);
                      if (res.ok) {
                        message.success(`连接成功${res.model ? `（${res.model}）` : ''}`);
                      } else {
                        message.error(`连接失败：${res.message}`);
                      }
                    } catch (err: any) {
                      message.error(err?.message || '测试失败');
                    } finally {
                      setTesting(false);
                    }
                  }}
                >
                  测试
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditingId(r.id);
                    form.setFieldsValue(r);
                    setOpen(true);
                  }}
                >
                  编辑
                </Button>
                <Popconfirm
                  title="确定删除该服务商？"
                  onConfirm={async () => {
                    try {
                      await deleteProvider(r.id);
                      message.success('已删除');
                      load();
                    } catch (err: any) {
                      message.error(err?.message || '删除失败');
                    }
                  }}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={open}
        title={editingId ? '编辑服务商' : '添加服务商'}
        onCancel={() => setOpen(false)}
        onOk={async () => {
          try {
            const values = await form.validateFields();
            if (editingId) {
              await updateProvider(editingId, values);
            } else {
              await createProvider(values);
            }
            message.success(editingId ? '已更新' : '已添加');
            setOpen(false);
            load();
          } catch (err: any) {
            // 表单校验失败（errorFields）由 AntD 自行提示；接口失败要给出可读信息
            if (err?.errorFields) return;
            message.error(err?.message || '保存服务商失败');
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="kind" label="类型" rules={[{ required: true }]}>
            <Select options={KINDS} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如：DeepSeek-R1" />
          </Form.Item>
          <Form.Item name="base_url" label="服务地址" rules={[{ required: true }]}>
            <Input placeholder="如：https://api.deepseek.com/v1" />
          </Form.Item>
          <Form.Item name="api_key" label="API Key">
            <Input.Password placeholder="编辑时不修改可留空" />
          </Form.Item>
          <Form.Item name="default_model" label="默认模型">
            <Input placeholder="如：deepseek-flash" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
