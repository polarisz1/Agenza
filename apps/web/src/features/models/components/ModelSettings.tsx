import {
  Button,
  Table,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  message,
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

const KINDS: { value: string; label: string }[] = [
  { value: 'openai-compat', label: 'OpenAI 兼容（GPT / DeepSeek 等）' },
  { value: 'ollama', label: 'Ollama 本地' },
  { value: 'anthropic-compat', label: 'Anthropic 兼容' },
];

export default function ModelSettings() {
  const [items, setItems] = useState<ProviderResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listProviders();
      setItems(data as any);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>模型与密钥</div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingId(null);
            form.resetFields();
            setOpen(true);
          }}
        >
          添加服务商
        </Button>
      </div>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
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
                    await deleteProvider(r.id);
                    message.success('已删除');
                    load();
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
          const values = await form.validateFields();
          if (editingId) {
            await updateProvider(editingId, values);
          } else {
            await createProvider(values);
          }
          message.success(editingId ? '已更新' : '已添加');
          setOpen(false);
          load();
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
            <Input placeholder="如：deepseek-chat" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
