import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';

import AppLayout from '@/shared/components/AppLayout';
import AuthGuard from '@/shared/components/AuthGuard';
import { authRoutes } from '@/features/auth';
import { useAuthStore } from '@/features/auth/hooks/useAuthStore';

/** 已登录时跳到默认工作空间，避免停在无 wsId 的列表页 */
function RootRedirect() {
  const wsId = useAuthStore((s) => s.workspaceId);
  return <Navigate to={wsId ? `/workspaces/${wsId}` : '/workspaces'} replace />;
}

// Feature modules export their own sub-routes
const workflowsRoutes: RouteObject[] = [
  {
    path: 'workflows',
    lazy: async () => {
      const mod = await import('@/features/workflows');
      return { Component: mod.WorkflowList };
    },
  },
  {
    path: 'workflows/:id',
    lazy: async () => {
      const mod = await import('@/features/workflows');
      return { Component: mod.WorkflowEditor };
    },
  },
];

const runsRoutes: RouteObject[] = [
  {
    path: 'runs',
    lazy: async () => {
      const mod = await import('@/features/runs');
      return { Component: mod.RunList };
    },
  },
  {
    // 必须排在 runs/:id 之前，否则 "compare" 会被当成 run id
    path: 'runs/compare',
    lazy: async () => {
      const mod = await import('@/features/runs');
      return { Component: mod.RunCompare };
    },
  },
  {
    path: 'runs/:id',
    lazy: async () => {
      const mod = await import('@/features/runs');
      return { Component: mod.RunDetail };
    },
  },
];

const modelsRoutes: RouteObject[] = [
  {
    path: 'models',
    lazy: async () => {
      const mod = await import('@/features/models');
      return { Component: mod.ModelSettings };
    },
  },
];

const settingsRoutes: RouteObject[] = [
  {
    path: 'settings',
    lazy: async () => {
      const mod = await import('@/features/settings');
      return { Component: mod.AppSettings };
    },
  },
];

const gatewayRoutes: RouteObject[] = [
  {
    path: 'gateway',
    lazy: async () => {
      const mod = await import('@/features/gateway');
      return { Component: mod.default };
    },
  },
];

const promptLibraryRoutes: RouteObject[] = [
  {
    path: 'prompt-library',
    lazy: async () => {
      const mod = await import('@/features/prompt-library');
      return { Component: mod.default };
    },
  },
];

const membersRoutes: RouteObject[] = [
  {
    path: 'members',
    lazy: async () => {
      const mod = await import('@/features/members');
      return { Component: mod.default };
    },
  },
];

const auditRoutes: RouteObject[] = [
  {
    path: 'audit',
    lazy: async () => {
      const mod = await import('@/features/audit');
      return { Component: mod.default };
    },
  },
];

/** SaaS 工作空间下的子路由：/workspaces/:wsId/* */
const workspaceChildren: RouteObject[] = [
  {
    index: true,
    lazy: async () => {
      const mod = await import('@/features/dashboard');
      return { Component: mod.default };
    },
  },
  ...workflowsRoutes,
  ...runsRoutes,
  ...modelsRoutes,
  ...settingsRoutes,
  ...gatewayRoutes,
  ...promptLibraryRoutes,
  ...membersRoutes,
  ...auditRoutes,
];

export const router = createBrowserRouter([
  // 登录 / 注册（无布局）
  ...authRoutes,

  // 工作空间列表：独立页面（没有 wsId 上下文，不能套 AppLayout 的侧边栏）
  {
    path: '/workspaces',
    element: (
      <AuthGuard>
        <Outlet />
      </AuthGuard>
    ),
    children: [
      {
        index: true,
        lazy: async () => {
          const mod = await import('@/features/workspaces');
          return { Component: mod.WorkspaceList };
        },
      },
    ],
  },

  // SaaS 主路由：/workspaces/:wsId/*
  {
    path: '/workspaces/:wsId',
    element: (
      <AuthGuard>
        <AppLayout />
      </AuthGuard>
    ),
    children: workspaceChildren,
  },

  // 根路径重定向：有默认工作空间就直接进去
  { path: '/', element: <RootRedirect /> },

  // 兜底：未登录回登录页由 AuthGuard 处理；其余回到工作空间列表
  { path: '*', element: <Navigate to="/workspaces" replace /> },
]);
