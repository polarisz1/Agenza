import { App, Button, Form, Input, Modal, Skeleton } from 'antd';
import { ArrowRight, FlowArrow, Plus, SignOut, UsersThree } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/features/auth/hooks/useAuthStore';
import EmptyState from '@/shared/components/EmptyState';
import { Avatar, Card, Pill } from '@/shared/components/ui';
import type { PillTone } from '@/shared/components/ui';
import { createWorkspace, listWorkspaces, type WorkspaceResponse } from '../api';
import './WorkspaceList.css';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  operator: 'Operator',
  viewer: 'Viewer',
};

function planTone(plan?: string): PillTone {
  const value = (plan || 'free').toLowerCase();
  if (value === 'free') return 'neutral';
  if (value === 'pro') return 'brand';
  return 'violet';
}

export default function WorkspaceList() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspaces(await listWorkspaces());
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载工作空间失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const ws = await createWorkspace(values);
      message.success('创建成功');
      setCreateOpen(false);
      form.resetFields();
      navigate(`/workspaces/${ws.id}`);
    } catch (err) {
      if (err instanceof Error && err.message) message.error(err.message);
    }
  };

  return (
    <div className="af-wsp">
      <header className="af-wsp__topbar">
        <div className="af-wsp__brand">
          <span className="af-wsp__logo">
            <FlowArrow size={16} weight="bold" />
          </span>
          <span>AgentFlow</span>
        </div>
        <div className="af-wsp__user">
          <span>{user?.name || user?.email || '用户'}</span>
          <Button
            type="text"
            icon={<SignOut size={15} />}
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            退出登录
          </Button>
        </div>
      </header>

      <main className="af-wsp__main">
        <div className="af-wsp__header">
          <div>
            <h1 className="af-wsp__title">我的工作空间</h1>
            <div className="af-wsp__subtitle">选择或创建一个工作空间继续</div>
          </div>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            创建工作空间
          </Button>
        </div>

        {loading && workspaces.length === 0 ? (
          <div className="af-wsp__loading">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : workspaces.length === 0 ? (
          <Card padded>
            <EmptyState
              title="还没有工作空间"
              description="创建一个工作空间，开始编排 AI 工作流。"
              action={<Button onClick={() => setCreateOpen(true)}>创建工作空间</Button>}
            />
          </Card>
        ) : (
          <div className="af-wsp__grid">
            {workspaces.map((ws) => (
              <Card
                key={ws.id}
                className="af-wsp__card"
                role="button"
                tabIndex={0}
                aria-label={`进入工作空间 ${ws.name}`}
                onClick={() => navigate(`/workspaces/${ws.id}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    navigate(`/workspaces/${ws.id}`);
                  }
                }}
              >
                <div className="af-wsp__head">
                  <Avatar name={ws.name} size="lg" shape="square" />
                  <Pill tone={planTone(ws.plan)}>{ws.plan || 'free'}</Pill>
                </div>
                <div className="af-wsp__name">{ws.name}</div>
                <div className="af-wsp__desc">{ws.description || '暂无描述'}</div>
                <div className="af-wsp__meta">
                  <UsersThree size={12} /> {ws.member_count} 位成员 ·{' '}
                  {ROLE_LABEL[ws.my_role] || ws.my_role}
                </div>
                <div className="af-wsp__footer">
                  <span>进入工作空间</span>
                  <ArrowRight size={13} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      <Modal
        title="创建工作空间"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入工作空间名称' }]}
          >
            <Input placeholder="例如：我的团队" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
