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
