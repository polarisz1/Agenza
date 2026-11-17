import { App, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  CaretDown,
  ChartLine,
  ClipboardText,
  Compass,
  Crown,
  FlowArrow,
  Gear,
  House,
  Key,
  MagnifyingGlass,
  PlayCircle,
  Question,
  SquaresFour,
  TreeStructure,
  UsersThree,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { components } from '@agenza/contracts';

import { http } from '@/shared/lib/http';
import { useAuthStore } from '@/features/auth/hooks/useAuthStore';
import { listWorkspaces, type WorkspaceResponse } from '@/features/workspaces';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { Avatar, IconButton, Pill } from './ui';
import './AppLayout.css';

type WorkflowListItem = components['schemas']['WorkflowListItem'];
type RunListItem = components['schemas']['RunListItem'];
type WorkflowListData = { items: WorkflowListItem[] };
type RunListData = { items: RunListItem[] };

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  editor: 'Editor',
  operator: 'Operator',
  viewer: 'Viewer',
};

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}

export default function AppLayout() {
  const { message } = App.useApp();
  const loc = useLocation();
  const navigate = useNavigate();
  const { wsId } = useParams<{ wsId: string }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isDesktop = useAuthStore((s) => s.isDesktop);

  // 后端不可达时常驻提示（B8），每 30s 探测一次
  const [offline, setOffline] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceResponse[]>([]);

  // 顶栏全局搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<WorkflowListItem[]>([]);
  const debouncedSearch = useDebouncedValue(searchQuery, 250);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        await http.get('/api/v1/settings/system/info');
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

  // 工作流搜索：只查当前工作空间可见的数据
  useEffect(() => {
    const term = debouncedSearch.trim();
    if (!term) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setSearchLoading(true);
    http
      .get<WorkflowListData>(`/api/v1/workflows?q=${encodeURIComponent(term)}`)
      .then((data) => {
        if (!cancelled) setSearchResults(data.items.slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setSearchResults([]);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const pathParts = loc.pathname.split('/').filter(Boolean);
  const segment = pathParts[2] || '';
  const menuPrefix = wsId ? `/workspaces/${wsId}` : '';
  const isEditor = segment === 'workflows' && pathParts.length > 3;

  const currentWs = workspaces.find((ws) => ws.id === wsId);
  const wsLabel = isDesktop ? '本地工作空间' : currentWs?.name || '工作空间';
  const plan = (currentWs?.plan || 'free').toLowerCase();
  const planLabel = plan === 'free' ? 'Free' : plan.charAt(0).toUpperCase() + plan.slice(1);
  const roleLabel = ROLE_LABEL[currentWs?.my_role || ''] || (isDesktop ? '本地用户' : '成员');

  const openEditor = async () => {
    try {
      const data = await http.get<WorkflowListData>('/api/v1/workflows?sort=updated_desc');
      const first = data.items[0];
      navigate(first ? `${menuPrefix}/workflows/${first.id}` : `${menuPrefix}/workflows`);
    } catch {
      navigate(`${menuPrefix}/workflows`);
    }
  };

  const openLatestRun = async () => {
    try {
      const data = await http.get<RunListData>('/api/v1/runs?limit=1');
      const first = data.items[0];
      navigate(first ? `${menuPrefix}/runs/${first.id}` : `${menuPrefix}/runs`);
    } catch {
      navigate(`${menuPrefix}/runs`);
    }
  };

  const navGroups: { title: string; items: NavItem[] }[] = [
    {
      title: '主菜单',
      items: [
        {
          key: 'dashboard',
          label: '概览 Dashboard',
          icon: <House size={18} />,
          active: !segment,
          onClick: () => navigate(menuPrefix),
        },
        {
          key: 'workflows',
          label: '工作流',
          icon: <SquaresFour size={18} />,
          active: segment === 'workflows' && !isEditor,
          onClick: () => navigate(`${menuPrefix}/workflows`),
        },
        {
          key: 'editor',
          label: '编辑器',
          icon: <TreeStructure size={18} />,
          active: isEditor,
          onClick: () => void openEditor(),
        },
      ],
    },
    {
      title: '运行与监控',
      items: [
        {
          key: 'runs',
          label: '运行记录',
          icon: <PlayCircle size={18} />,
          active: segment === 'runs' && pathParts.length === 3,
          onClick: () => navigate(`${menuPrefix}/runs`),
        },
        {
          key: 'run-detail',
          label: '运行详情',
          icon: <ChartLine size={18} />,
          active: segment === 'runs' && pathParts.length > 3,
          onClick: () => void openLatestRun(),
        },
      ],
    },
    {
      title: 'AI 与模型',
      items: [
        {
          key: 'gateway',
          label: 'AI Gateway',
          icon: <Compass size={18} />,
          active: segment === 'gateway',
          onClick: () => navigate(`${menuPrefix}/gateway`),
        },
        {
          key: 'models',
          label: '模型与密钥',
          icon: <Key size={18} />,
          active: segment === 'models',
          onClick: () => navigate(`${menuPrefix}/models`),
        },
        {
          key: 'prompt-library',
          label: 'Prompt Library',
          icon: <BookOpen size={18} />,
          active: segment === 'prompt-library',
          onClick: () => navigate(`${menuPrefix}/prompt-library`),
        },
      ],
    },
    {
      title: '协作',
      items: [
        {
          key: 'members',
          label: '成员管理',
          icon: <UsersThree size={18} />,
          active: segment === 'members',
          onClick: () => navigate(`${menuPrefix}/members`),
        },
        {
          key: 'audit',
          label: '审计日志',
          icon: <ClipboardText size={18} />,
          active: segment === 'audit',
          onClick: () => navigate(`${menuPrefix}/audit`),
        },
      ],
    },
  ];

  const workspaceMenu: MenuProps = {
    items: [
      ...workspaces.map((ws) => ({ key: ws.id, label: ws.name })),
      ...(workspaces.length > 0 ? [{ type: 'divider' as const }] : []),
      { key: '__manage', label: '管理工作空间' },
    ],
    onClick: ({ key }) => {
      if (key === '__manage') {
        navigate('/workspaces');
        return;
      }
      const rest = pathParts.slice(2).join('/');
      navigate(`/workspaces/${key}${rest ? `/${rest}` : ''}`);
    },
  };

  const userMenu: MenuProps = {
    items: isDesktop
      ? [
          { key: 'open-data', label: '打开数据目录' },
          { key: 'about', label: '关于 Agenza' },
        ]
      : [
          { key: 'profile', label: user?.email || user?.name || '账户', disabled: true },
          { key: 'logout', label: '退出登录' },
        ],
    onClick: async ({ key }) => {
      const bridge = (window as { electronAPI?: { openDataDir?: () => void } }).electronAPI;
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
        message.info('Agenza · 自托管 AI 工作流编排平台');
      }
    },
  };

  const displayName = isDesktop ? '本地用户' : user?.name || user?.email || '用户';

  return (
    <div className="af-shell">
      <header className="af-topbar">
        <button type="button" className="af-brand" onClick={() => navigate(menuPrefix)}>
          <span className="af-brand__logo">
            <FlowArrow size={16} weight="bold" />
          </span>
          <span className="af-brand__name">Agenza</span>
          <Pill tone={plan === 'free' ? 'neutral' : 'brand'}>{planLabel}</Pill>
        </button>

        {!isDesktop && (
          <Dropdown menu={workspaceMenu} trigger={['click']}>
            <button type="button" className="af-workspace">
              <Avatar name={wsLabel} size="sm" shape="square" />
              <span className="af-workspace__name">{wsLabel}</span>
              <CaretDown size={12} className="af-workspace__caret" />
            </button>
          </Dropdown>
        )}

        <div className="af-topbar__spacer" />

        <div className="af-search">
          <MagnifyingGlass size={14} className="af-search__icon" />
          <input
            className="af-search__input"
            value={searchQuery}
            placeholder="搜索工作流..."
            aria-label="搜索工作流"
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
          />
          {searchOpen && searchQuery.trim() && (
            <div
              className="af-search__panel"
              onMouseDown={(event) => event.preventDefault()}
            >
              {searchLoading ? (
                <div className="af-search__empty">搜索中…</div>
              ) : searchResults.length === 0 ? (
                <div className="af-search__empty">没有匹配的工作流</div>
              ) : (
                searchResults.map((wf) => (
                  <button
                    key={wf.id}
                    type="button"
                    className="af-search__result"
                    onClick={() => {
                      navigate(`${menuPrefix}/workflows/${wf.id}`);
                      setSearchQuery('');
                      setSearchOpen(false);
                    }}
                  >
                    <span className="af-search__result-name">{wf.name}</span>
                    <span className="af-search__result-meta">{wf.node_count} 节点</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="af-topbar__actions">
          <div className="af-bell">
            <IconButton label="通知" icon={<Bell size={18} />} />
            <span className="af-bell__dot" />
          </div>
          <IconButton label="帮助" icon={<Question size={18} />} />
          <div className="af-topbar__divider" />
          <Dropdown menu={userMenu} trigger={['click']}>
            <button type="button" className="af-user">
              <Avatar name={displayName} size="md" />
              <span className="af-user__meta">
                <span className="af-user__name">{displayName}</span>
                <span className="af-user__role">{roleLabel}</span>
              </span>
            </button>
          </Dropdown>
        </div>
      </header>

      {offline && (
        <div className="af-offline">
          <span>无法连接后端 · 读操作会失败</span>
          <button type="button" onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      )}

      <div className="af-body">
        <aside className="af-sidebar">
          <nav className="af-sidebar__nav">
            {navGroups.map((group) => (
              <div className="af-nav-group" key={group.title}>
                <div className="af-nav-group__title">{group.title}</div>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`af-nav-item${item.active ? ' af-nav-item--active' : ''}`}
                    aria-current={item.active ? 'page' : undefined}
                    onClick={item.onClick}
                  >
                    <span className="af-nav-item__icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}

            <div className="af-sidebar__divider" />
            <button
              type="button"
              className={`af-nav-item${segment === 'settings' ? ' af-nav-item--active' : ''}`}
              aria-current={segment === 'settings' ? 'page' : undefined}
              onClick={() => navigate(`${menuPrefix}/settings`)}
            >
              <span className="af-nav-item__icon">
                <Gear size={18} />
              </span>
              <span>设置中心</span>
            </button>
          </nav>

          <div className="af-sidebar__pro">
            <div className="af-sidebar__pro-head">
              <Crown size={15} weight="fill" />
              <span>{planLabel} 计划</span>
            </div>
            <div className="af-sidebar__pro-body">
              <div className="af-sidebar__pro-text">Token 用量统计即将上线</div>
              <div className="af-sidebar__pro-bar">
                <span style={{ width: '0%' }} />
              </div>
              <button
                type="button"
                className="af-sidebar__pro-btn"
                onClick={() => navigate(`${menuPrefix}/settings`)}
              >
                <span>查看用量</span>
                <ArrowUpRight size={11} />
              </button>
            </div>
          </div>
        </aside>

        <main className="af-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
