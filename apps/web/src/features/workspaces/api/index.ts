import { http } from '@/shared/lib/http';
import type { components } from '@agentflow/contracts';

export type WorkspaceResponse = components['schemas']['WorkspaceResponse'];
export type WorkspaceCreate = components['schemas']['WorkspaceCreate'];
export type WorkspaceUpdate = components['schemas']['WorkspaceUpdate'];
export type WorkspaceMemberItem = components['schemas']['WorkspaceMemberItem'];

/** 获取当前用户的工作空间列表 */
export async function listWorkspaces(): Promise<WorkspaceResponse[]> {
  const data = await http.get<{ items: WorkspaceResponse[] }>('/api/v1/workspaces');
  return data.items ?? [];
}

/** 创建工作空间 */
export async function createWorkspace(body: WorkspaceCreate): Promise<WorkspaceResponse> {
  return http.post<WorkspaceResponse>('/api/v1/workspaces', body);
}

/** 获取工作空间详情 */
export async function getWorkspace(wsId: string): Promise<WorkspaceResponse> {
  return http.get<WorkspaceResponse>(`/api/v1/workspaces/${wsId}`);
}

/** 更新工作空间 */
export async function updateWorkspace(wsId: string, body: WorkspaceUpdate): Promise<WorkspaceResponse> {
  return http.put<WorkspaceResponse>(`/api/v1/workspaces/${wsId}`, body);
}

/** 删除工作空间 */
export async function deleteWorkspace(wsId: string): Promise<void> {
  await http.delete(`/api/v1/workspaces/${wsId}`);
}

/** 获取工作空间成员列表 */
export async function listMembers(wsId: string): Promise<WorkspaceMemberItem[]> {
  const data = await http.get<{ items: WorkspaceMemberItem[] }>(
    `/api/v1/workspaces/${wsId}/members`,
  );
  return data.items ?? [];
}
