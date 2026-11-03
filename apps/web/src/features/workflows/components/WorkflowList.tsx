import { Alert, App, Button, Dropdown, Input, Select, Skeleton, Table, Tag, Space } from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  MoreOutlined,
  CopyOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  listWorkflows,
  deleteWorkflow,
  duplicateWorkflow,
  createWorkflow,
  listProviderOptions,
} from '../api';
import type { WorkflowListItem } from '../api';
import { WORKFLOW_TEMPLATES } from '../templates';
import EmptyState from '@/shared/components/EmptyState';
import OnboardingWizard from './OnboardingWizard';
import TemplateGallery from './TemplateGallery';
import { formatDateTime } from '@/shared/utils/datetime';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

const ONBOARDING_KEY = 'agentflow.onboarded.v2';

export default function WorkflowList() {
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const wsPrefix = wsId ? `/workspaces/${wsId}` : '';
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<string>('updated_desc');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // 搜索防抖：每敲一个字就发一次请求既浪费也容易乱序（评审 G25）
  const debouncedQ = useDebouncedValue(q, 300);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listWorkflows(debouncedQ || undefined, undefined, sort);
      setItems(data);
    } catch (err: any) {
      // 以前只有 try/finally：接口失败会变成空表 + unhandled rejection（G22）
      setLoadError(err?.message || '加载工作流失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedQ, sort]);

  useEffect(() => {
    load();
  }, [load]);

  // 首次使用（无工作流 + 无服务商）时弹引导；完成/跳过写本地标记（F4）
  useEffect(() => {
    if (loading || items.length > 0) return;
    if (localStorage.getItem(ONBOARDING_KEY) === '1') return;
    let cancelled = false;
    listProviderOptions()
      .then((providers) => {
        if (!cancelled && providers.length === 0) setShowOnboarding(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [loading, items.length]);

  const handleCreate = async (key: string) => {
    setGalleryOpen(false);
    setCreating(true);
    try {
      if (key === 'blank') {
        const wf = await createWorkflow({
          name: '未命名工作流',
          description: '',
          graph: { version: 1, inputs: [], nodes: [], edges: [] },
        });
        nav(`${wsPrefix}/workflows/${wf.id}`);
        return;
      }

      const template = WORKFLOW_TEMPLATES.find((item) => item.key === key);
      if (!template) return;
      // 模板自带描述，创建时一并落库，列表的「描述」列才有内容（评审 G28）
      const wf = await createWorkflow({
        name: template.name,
        description: template.description,
        graph: template.build(),
      });
      nav(`${wsPrefix}/workflows/${wf.id}`);
    } catch (err: any) {
      message.error(err?.message || '创建工作流失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateWorkflow(id);
      message.success('已复制');
      load();
    } catch (err: any) {
      message.error(err?.message || '复制失败');
    }
  };

  const handleDelete = (id: string) => {
    modal.confirm({
      title: '确定删除该工作流？',
      content: '将一并删除该工作流的全部运行记录。此操作不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteWorkflow(id);
          message.success('已删除');
          load();
        } catch (err: any) {
          message.error(err?.message || '删除失败');
        }
      },
    });
  };

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
          <Button
            type="primary"
            icon={<PlusOutlined />}
            loading={creating}
            onClick={() => setGalleryOpen(true)}
          >
            新建工作流
          </Button>
        </Space>
      </div>

      {loadError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="加载工作流失败"
          description={loadError}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      {loading && items.length === 0 ? (
        <div style={{ padding: 20, background: '#fff', borderRadius: 10 }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={items}
          scroll={{ x: 1140 }}
          locale={{
            emptyText: loading ? (
              <span />
            ) : (
              <EmptyState
                title={debouncedQ ? '没有匹配的工作流' : '还没有工作流'}
                description={
                  debouncedQ
                    ? '换个关键词，或清除搜索条件。'
                    : '新建一张空白画布，或等模板中心上线后从模板开始。'
                }
                action={
                  debouncedQ ? (
                    <Button onClick={() => setQ('')}>清除搜索</Button>
                  ) : (
                    <Button type="primary" onClick={() => void handleCreate('blank')}>
                      新建空白工作流
                    </Button>
                  )
                }
              />
            ),
          }}
          columns={[
            {
              title: '名称',
              dataIndex: 'name',
              width: 260,
              render: (text, record) => (
                <a onClick={() => nav(`${wsPrefix}/workflows/${record.id}`)}>{text}</a>
              ),
            },
            {
              title: '描述',
              dataIndex: 'description',
              ellipsis: true,
              render: (value?: string | null) => value || '—',
            },
            {
              // 不再展示不可控的"草稿/就绪"（D-13）：按当前图实时给出可用性
              title: '可用性',
              key: 'availability',
              width: 120,
              render: (_, record) =>
                record.blocking_count > 0 ? (
                  <Tag color="red">{record.blocking_count} 个阻断</Tag>
                ) : record.issue_count > 0 ? (
                  <Tag color="orange">{record.issue_count} 个提示</Tag>
                ) : (
                  <Tag color="green">可用</Tag>
                ),
            },
            { title: '节点数', dataIndex: 'node_count', width: 80 },
            {
              title: '最近运行',
              dataIndex: 'last_run_at',
              width: 170,
              render: (value) => formatDateTime(value),
            },
            {
              title: '最近编辑',
              dataIndex: 'updated_at',
              width: 150,
              render: (value) => formatDateTime(value),
            },
            {
              title: '操作',
              key: 'ops',
              width: 130,
              fixed: 'right',
              render: (_, record) => (
                <Space size={2}>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => nav(`${wsPrefix}/workflows/${record.id}`)}
                  >
                    编辑
                  </Button>
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'duplicate', label: '复制', icon: <CopyOutlined /> },
                        { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'duplicate') void handleDuplicate(record.id);
                        if (key === 'delete') handleDelete(record.id);
                      },
                    }}
                  >
                    <Button
                      type="link"
                      size="small"
                      icon={<MoreOutlined />}
                      aria-label="更多操作"
                    />
                  </Dropdown>
                </Space>
              ),
            },
          ]}
        />
      )}

      <TemplateGallery
        open={galleryOpen}
        creating={creating}
        onClose={() => setGalleryOpen(false)}
        onPick={(key) => void handleCreate(key)}
      />

      <OnboardingWizard
        open={showOnboarding}
        onClose={(done) => {
          setShowOnboarding(false);
          if (done) localStorage.setItem(ONBOARDING_KEY, '1');
        }}
        onOpenWorkflow={(workflowId) => nav(`${wsPrefix}/workflows/${workflowId}`)}
      />
    </div>
  );
}
