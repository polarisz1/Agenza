import { App, Layout, Menu, theme, Avatar, Dropdown } from 'antd';
import {
  AppstoreOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  SettingOutlined,
  UserOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { http } from '@/shared/lib/http';

const { Header, Sider, Content } = Layout;

const menu = [
  { key: '/workflows', icon: <RobotOutlined />, label: '工作流' },
  { key: '/runs', icon: <ThunderboltOutlined />, label: '运行记录' },
  { key: '/models', icon: <ApiOutlined />, label: '模型配置' },
  { key: '/settings', icon: <SettingOutlined />, label: '本机设置' },
];

export default function AppLayout() {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const loc = useLocation();
  // 后端不可达时常驻提示（B8），每 30s 探测一次
  const [offline, setOffline] = useState(false);

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
          selectedKeys={[loc.pathname]}
          style={{ border: 0, padding: '8px 12px' }}
          items={menu.map((m) => ({
            key: m.key,
            icon: m.icon,
            label: <Link to={m.key}>{m.label}</Link>,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: '#8b9088', fontSize: 12 }}>AgentFlow</span>
            <span style={{ color: '#c0c3bb' }}>/</span>
            <span style={{ fontWeight: 600 }}>
              {menu.find((m) => loc.pathname === m.key || loc.pathname.startsWith(`${m.key}/`))
                ?.label || '工作流'}
            </span>
          </div>
          <Dropdown
            menu={{
              items: [
                { key: 'open-data', icon: <SettingOutlined />, label: '打开数据目录' },
                { key: 'about', label: '关于 AgentFlow v0.1' },
              ],
              onClick: ({ key }) => {
                // 桌面壳注入了 window.electronAPI；浏览器里没有这个能力，
                // 给出可理解的提示而不是"点了没反应"（评审 G27）
                const bridge = (window as { electronAPI?: { openDataDir?: () => void } })
                  .electronAPI;
                if (key === 'open-data') {
                  if (bridge?.openDataDir) bridge.openDataDir();
                  else message.info('仅桌面版支持打开数据目录；路径见「本机设置」页');
                  return;
                }
                if (key === 'about') {
                  message.info('AgentFlow v0.1 · 本地单用户 AI 工作流编排');
                }
              },
            }}
          >
            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>本地用户</span>
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
