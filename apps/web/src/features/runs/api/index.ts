import { http } from '@/shared/lib/http';
import type { ApiData, ApiQuery, components } from '@agentflow/contracts';

export type RunListItem = components['schemas']['RunListItem'];
export type RunDetail = components['schemas']['RunDetail'];
export type RunNodeDetail = components['schemas']['NodeRunDetail'];
export type RunResponse = components['schemas']['RunResponse'];
export type CancelResult = components['schemas']['CancelResult'];

type RunListData = ApiData<'/api/runs', 'get'>;
type WorkflowListData = ApiData<'/api/workflows', 'get'>;

/** 运行列表的"按工作流筛选"选项：从契约里的列表项派生，不再手写（评审 G24） */
export type WorkflowOption = Pick<components['schemas']['WorkflowListItem'], 'id' | 'name'>;

/** 运行列表查询参数：直接取后端 `/api/runs` 的 query 契约（评审 G24） */
export type RunListQuery = ApiQuery<'/api/runs', 'get'>;

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
  // 后端 /api/workflows 没有 limit 参数（此前带 ?limit=200 会被静默忽略，评审 G24）
  const data = await http.get<WorkflowListData>('/api/workflows');
  return data.items.map((item) => ({ id: item.id, name: item.name }));
}
