import { createBrowserRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';

import AppLayout from '@/shared/components/AppLayout';

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

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/workflows" replace /> },
      ...workflowsRoutes,
      ...runsRoutes,
      ...modelsRoutes,
      ...settingsRoutes,
    ],
  },
]);
