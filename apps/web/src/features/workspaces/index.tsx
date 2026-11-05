import type { RouteObject } from 'react-router-dom';
import WorkspaceList from './components/WorkspaceList';

export const workspaceRoutes: RouteObject[] = [
  { path: 'workspaces', element: <WorkspaceList /> },
];

export { default as WorkspaceList } from './components/WorkspaceList';
export { listWorkspaces, createWorkspace, getWorkspace, updateWorkspace, deleteWorkspace } from './api';
export type { WorkspaceResponse, WorkspaceCreate, WorkspaceUpdate } from './api';
