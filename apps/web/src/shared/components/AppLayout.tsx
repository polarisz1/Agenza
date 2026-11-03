import { App, Layout, Menu, theme, Avatar, Dropdown, Space, Select } from 'antd';
import {
  AppstoreOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  SettingOutlined,
  UserOutlined,
  RobotOutlined,
  DashboardOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';

import { http } from '@/shared/lib/http';
import { useAuthStore } from '@/features/auth/hooks/useAuthStore';
import { listWorkspaces, type WorkspaceResponse } from '@/features/workspaces';

const { Header, Sider, Content } = Layout;

const menu = [
  { key: '', icon: <DashboardOutlined />, label: '概览' },
  { key: 'workflows', icon: <RobotOutlined />, label: '工作流' },
  { key: 'runs', icon: <ThunderboltOutlined />, label: '运行记录' },
  { key: 'models', icon: <ApiOutlined />, label: '模型配置' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
];

export default function AppLayout() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const loc = useLocation();
  const navigate = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isDesktop = useAuthStore((s) => s.isDesktop);

  // 后端不可达时常驻提示（B8），每 30s 探测一次
  const [offline, setOffline] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        await http.get('/api/settings/system/info');
        if (!cancelled) setOffline(false);
      } catch {
        if (!cancelled) setOffline(true);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // 加载工作空间列表（用于 workspace switcher）
  useEffect(() => {
    if (isDesktop) return;
    let cancelled = false;
    listWorkspaces()
      .then((list) => {
        if (!cancelled) setWorkspaces(list);
      })
      .catch(() => {
        // 忽略加载失败，switcher 仅显示当前
      });
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  // 从路径提取当前选中的菜单 key
  const pathParts = loc.pathname.split('/').filter(Boolean);
  // /workspaces/:wsId → ""（概览）；/workspaces/:wsId/workflows → "workflows"
  const activeKey = pathParts[2] || '';

  const menuPrefix = wsId ? `/workspaces/${wsId}` : '';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="light" style={{ borderRight: '1px solid #e2e0d8' }}>
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 20px',
            borderBottom: '1px solid #e2e0d8',
          }}
        >
          <AppstoreOutlined style={{ color: '#1F4E3D', fontSize: 22 }} />
          <span style={{ fontWeight: 600, fontSize: 16 }}>AgentFlow</span>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          style={{ border: 0, padding: '8px 12px' }}
          items={menu.map((m) => ({
            key: m.key,
            icon: m.icon,
            label: <Link to={m.key ? `${menuPrefix}/${m.key}` : menuPrefix}>{m.label}</Link>,
          }))}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: '1px solid #e2e0d8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
            {!isDesktop && wsId && (
              <Select
                value={wsId}
                size="small"
                style={{ minWidth: 160 }}
                suffixIcon={<TeamOutlined />}
                options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
                onChange={(newWsId) => navigate(`/workspaces/${newWsId}/${activeKey}`)}
              />
            )}
            <span style={{ color: '#c0c3bb' }}>/</span>
            <span style={{ fontWeight: 600 }}>
              {menu.find((m) => m.key === activeKey)?.label || '工作流'}
            </span>
          </div>
          <Dropdown
            menu={{
              items: isDesktop
                ? [
                    { key: 'open-data', icon: <SettingOutlined />, label: '打开数据目录' },
                    { key: 'about', label: '关于 AgentFlow' },
                  ]
                : [
                    { key: 'profile', icon: <UserOutlined />, label: user?.name || '账户' },
                    { key: 'logout', icon: <SettingOutlined />, label: '退出登录' },
                  ],
              onClick: async ({ key }) => {
                const bridge = (window as { electronAPI?: { openDataDir?: () => void } })
                  .electronAPI;
                if (key === 'open-data') {
                  if (bridge?.openDataDir) bridge.openDataDir();
                  else message.info('仅桌面版支持打开数据目录');
                  return;
                }
                if (key === 'logout') {
                  await logout();
                  window.location.href = '/login';
                }
                if (key === 'about') {
                  message.info('AgentFlow · 多租户 AI 工作流编排平台');
                }
              },
            }}
          >
            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Space>
                {isDesktop ? (
                  <span>本地用户</span>
                ) : (
                  <span>{user?.name || user?.email || '用户'}</span>
                )}
              </Space>
            </span>
          </Dropdown>
        </Header>
        {offline && (
          <div
            style={{
              padding: '6px 24px',
              background: '#fdf2ea',
              borderBottom: '1px solid #efd8b8',
              color: '#a86612',
              fontSize: 12,
            }}
          >
            无法连接后端 · 读操作会失败
            <a
              style={{ marginLeft: 10, color: '#1f4e3d', fontWeight: 600 }}
              onClick={() => window.location.reload()}
            >
              重试
            </a>
          </div>
        )}
        <Content style={{ padding: 24, background: '#f4f5f2', minHeight: 'calc(100vh - 64px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
