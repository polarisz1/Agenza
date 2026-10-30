import { Button, Dropdown, Input, Select, Table, Tag, Space, Popconfirm, message } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { listWorkflows, deleteWorkflow, duplicateWorkflow, createWorkflow } from '../api';
import type { WorkflowListItem } from '../api';
import { WORKFLOW_TEMPLATES } from '../templates';
import { formatDateTime } from '@/shared/utils/datetime';

export default function WorkflowList() {
  const nav = useNavigate();
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
  const [sort, setSort] = useState<string>('updated_desc');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWorkflows(q || undefined, status || undefined, sort);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [q, status, sort]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (key: string) => {
    setCreating(true);
    try {
      if (key === 'blank') {
        const wf = await createWorkflow({
          name: '未命名工作流',
          graph: { version: 1, inputs: [], nodes: [], edges: [] },
        });
        nav(`/workflows/${wf.id}`);
        return;
      }

      const template = WORKFLOW_TEMPLATES.find((item) => item.key === key);
      if (!template) return;
      const wf = await createWorkflow({ name: template.name, graph: template.build() });
      nav(`/workflows/${wf.id}`);
    } catch (err: any) {
      message.error(err?.message || '创建工作流失败');
    } finally {
      setCreating(false);
    }
  };

  const menuItems = [
    { key: 'blank', label: '空白工作流' },
    { type: 'divider' as const },
    ...WORKFLOW_TEMPLATES.map((template) => ({
      key: template.key,
      label: (
        <div>
          <div>模板 · {template.name}</div>
          <div style={{ fontSize: 11, color: '#8b9088' }}>{template.description}</div>
        </div>
      ),
    })),
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600 }}>工作流</div>
        <Space wrap>
          <Select
            value={status}
            style={{ width: 120 }}
            onChange={setStatus}
            options={[
              { value: '', label: '全部状态' },
              { value: 'draft', label: '草稿' },
              { value: 'ready', label: '已就绪' },
            ]}
          />
          <Select
            value={sort}
            style={{ width: 140 }}
            onChange={setSort}
            options={[
              { value: 'updated_desc', label: '最近编辑' },
              { value: 'last_run_desc', label: '最近运行' },
            ]}
          />
          <Input
            allowClear
            placeholder="搜索工作流"
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onPressEnter={load}
          />
          <Dropdown
            menu={{ items: menuItems, onClick: ({ key }) => void handleCreate(key) }}
            trigger={['click']}
            disabled={creating}
          >
            <Button type="primary" icon={<PlusOutlined />} loading={creating}>
              新建工作流
            </Button>
          </Dropdown>
        </Space>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={[
          {
            title: '名称',
            dataIndex: 'name',
            render: (text, record) => <a onClick={() => nav(`/workflows/${record.id}`)}>{text}</a>,
          },
          { title: '描述', dataIndex: 'description', ellipsis: true },
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (value) =>
              value === 'ready' ? <Tag color="green">就绪</Tag> : <Tag>草稿</Tag>,
          },
          { title: '节点数', dataIndex: 'node_count', width: 90 },
          {
            title: '最近运行',
            dataIndex: 'last_run_at',
            width: 180,
            render: (value) => formatDateTime(value),
          },
          {
            title: '最近编辑',
            dataIndex: 'updated_at',
            width: 180,
            render: (value) => formatDateTime(value),
          },
          {
            title: '操作',
            key: 'ops',
            width: 180,
            render: (_, record) => (
              <Space>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => nav(`/workflows/${record.id}`)}
                >
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    await duplicateWorkflow(record.id);
                    message.success('已复制');
                    load();
                  }}
                >
                  复制
                </Button>
                <Popconfirm
                  title="确定删除该工作流？"
                  description="将一并删除该工作流的全部运行记录。此操作不可撤销。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={async () => {
                    await deleteWorkflow(record.id);
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
    </div>
  );
}
