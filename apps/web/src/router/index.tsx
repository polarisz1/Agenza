import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';

import AppLayout from '@/shared/components/AppLayout';
import AuthGuard from '@/shared/components/AuthGuard';
import { authRoutes } from '@/features/auth';

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
];

export const router = createBrowserRouter([
  // 登录 / 注册（无布局）
  ...authRoutes,

  // 工作空间列表
  {
    path: '/workspaces',
    element: (
      <AuthGuard>
        <AppLayout />
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

  // 根路径重定向
  { path: '/', element: <Navigate to="/workspaces" replace /> },

  // 兜底：未匹配路径回到工作空间列表
  { path: '*', element: <Navigate to="/workspaces" replace /> },
]);
