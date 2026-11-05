import { http } from '@/shared/lib/http';
import type { components } from '@agentflow/contracts';

export type RunListItem = components['schemas']['RunListItem'];
export type WorkflowListItem = components['schemas']['WorkflowListItem'];
export type WorkspaceResponse = components['schemas']['WorkspaceResponse'];
export type WorkflowResponse = components['schemas']['WorkflowResponse'];

/** 获取运行记录列表（用于 Dashboard 聚合） */
export async function fetchDashboardRuns(): Promise<RunListItem[]> {
  const data = await http.get<{ items: RunListItem[] }>('/api/v1/runs?limit=200');
  return data.items ?? [];
}

/** 获取工作流列表（用于 Dashboard 热门工作流） */
export async function fetchDashboardWorkflows(): Promise<WorkflowListItem[]> {
  const data = await http.get<{ items: WorkflowListItem[] }>('/api/v1/workflows?limit=100');
  return data.items ?? [];
}

/** 当前工作空间信息（用于问候语里的空间名称） */
export async function fetchWorkspace(wsId: string): Promise<WorkspaceResponse> {
  return http.get<WorkspaceResponse>(`/api/v1/workspaces/${wsId}`);
}

/** 从 Dashboard 直接新建一个空白工作流 */
export async function createBlankWorkflow(): Promise<WorkflowResponse> {
  return http.post<WorkflowResponse>('/api/v1/workflows', {
    name: '未命名工作流',
    description: '',
    graph: { version: 1, inputs: [], nodes: [], edges: [] },
  });
}
