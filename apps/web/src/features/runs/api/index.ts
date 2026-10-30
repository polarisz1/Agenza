import { http } from '@/shared/lib/http';
import type { ApiData, components } from '@agentflow/contracts';

export type RunListItem = components['schemas']['RunListItem'];
export type RunDetail = components['schemas']['RunDetail'];
export type RunNodeDetail = components['schemas']['NodeRunDetail'];
export type RunResponse = components['schemas']['RunResponse'];
export type CancelResult = components['schemas']['CancelResult'];

type RunListData = ApiData<'/api/runs', 'get'>;
type WorkflowListData = ApiData<'/api/workflows', 'get'>;

export interface WorkflowOption {
  id: string;
  name: string;
}

export interface RunListQuery {
  workflow_id?: string;
  status?: string;
  limit?: number;
  started_after?: string;
  started_before?: string;
}

export async function listRuns(query: RunListQuery = {}): Promise<RunListItem[]> {
  const params = new URLSearchParams();
  if (query.workflow_id) params.set('workflow_id', query.workflow_id);
  if (query.status) params.set('status', query.status);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.started_after) params.set('started_after', query.started_after);
  if (query.started_before) params.set('started_before', query.started_before);
  const data = await http.get<RunListData>(
    `/api/runs${params.toString() ? `?${params.toString()}` : ''}`,
  );
  return data.items;
}

export async function getRun(id: string): Promise<RunDetail> {
  return http.get<RunDetail>(`/api/runs/${id}`);
}

export async function getRunNode(runId: string, nodeId: string): Promise<RunNodeDetail> {
  return http.get<RunNodeDetail>(`/api/runs/${runId}/nodes/${nodeId}`);
}

export async function cancelRun(id: string): Promise<CancelResult> {
  return http.post<CancelResult>(`/api/runs/${id}/cancel`);
}

export async function rerunRun(id: string): Promise<RunResponse> {
  return http.post<RunResponse>(`/api/runs/${id}/rerun`);
}

/** 运行列表的“按工作流筛选”下拉选项 */
export async function listWorkflowOptions(): Promise<WorkflowOption[]> {
  const data = await http.get<WorkflowListData>('/api/workflows?limit=200');
  return data.items.map((item) => ({ id: item.id, name: item.name }));
}
