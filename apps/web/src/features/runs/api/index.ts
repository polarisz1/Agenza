import { http } from '@/shared/lib/http';
import type { ApiData, ApiQuery, components } from '@agenza/contracts';

export type RunListItem = components['schemas']['RunListItem'];
export type RunDetail = components['schemas']['RunDetail'];
export type RunNodeDetail = components['schemas']['NodeRunDetail'];
export type RunResponse = components['schemas']['RunResponse'];
export type CancelResult = components['schemas']['CancelResult'];
export type CompareNode = components['schemas']['CompareNode'];
export type RunCompareResult = components['schemas']['RunCompareResult'];
export type RunDiagnosis = components['schemas']['RunDiagnosisResponse'];
export type NodeDiagnosis = components['schemas']['NodeDiagnosis'];
export type DiagnosisSuggestion = components['schemas']['DiagnosisSuggestion'];
export type DeepDiagnosis = components['schemas']['DeepDiagnosisResponse'];
export type RunDiagnosisTrend = components['schemas']['RunDiagnosisTrendResponse'];
export type DiagnosisCategoryStat = components['schemas']['DiagnosisCategoryStat'];
export type DiagnosisTrendPoint = components['schemas']['DiagnosisTrendPoint'];

type RunListData = ApiData<'/api/v1/runs', 'get'>;
type WorkflowListData = ApiData<'/api/v1/workflows', 'get'>;

/** 运行列表的"按工作流筛选"选项：从契约里的列表项派生，不再手写（评审 G24） */
export type WorkflowOption = Pick<components['schemas']['WorkflowListItem'], 'id' | 'name'>;

/** 运行列表查询参数：直接取后端 `/api/v1/runs` 的 query 契约（评审 G24） */
export type RunListQuery = ApiQuery<'/api/v1/runs', 'get'>;

export async function listRuns(query: RunListQuery = {}): Promise<RunListItem[]> {
  const params = new URLSearchParams();
  if (query.workflow_id) params.set('workflow_id', query.workflow_id);
  if (query.status) params.set('status', query.status);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.started_after) params.set('started_after', query.started_after);
  if (query.started_before) params.set('started_before', query.started_before);
  const data = await http.get<RunListData>(
    `/api/v1/runs${params.toString() ? `?${params.toString()}` : ''}`,
  );
  return data.items;
}

export async function getRun(id: string): Promise<RunDetail> {
  return http.get<RunDetail>(`/api/v1/runs/${id}`);
}

export async function getRunNode(runId: string, nodeId: string): Promise<RunNodeDetail> {
  return http.get<RunNodeDetail>(`/api/v1/runs/${runId}/nodes/${nodeId}`);
}

/** GATE-04：自动根因分析（后端确定性规则，不调用模型） */
export async function getRunDiagnosis(runId: string): Promise<RunDiagnosis> {
  return http.get<RunDiagnosis>(`/api/v1/runs/${runId}/diagnosis`);
}

/** GATE-04 Phase 3：跨运行趋势（同类失败 Top N + 成功率/空输出率） */
export async function getRunDiagnosisTrends(
  params: { workflowId?: string; days?: number; top?: number } = {},
): Promise<RunDiagnosisTrend> {
  const search = new URLSearchParams();
  if (params.workflowId) search.set('workflow_id', params.workflowId);
  if (params.days) search.set('days', String(params.days));
  if (params.top) search.set('top', String(params.top));
  const query = search.toString();
  return http.get<RunDiagnosisTrend>(`/api/v1/runs/diagnosis/trends${query ? `?${query}` : ''}`);
}

/** GATE-04 Phase 2：按需 AI 深度分析（预算/缓存/脱敏由后端处理） */
export async function analyzeRunDiagnosis(runId: string, refresh = false): Promise<DeepDiagnosis> {
  const query = refresh ? '?refresh=true' : '';
  return http.post<DeepDiagnosis>(`/api/v1/runs/${runId}/diagnosis/deep${query}`);
}

export async function cancelRun(id: string): Promise<CancelResult> {
  return http.post<CancelResult>(`/api/v1/runs/${id}/cancel`);
}

export async function rerunRun(id: string): Promise<RunResponse> {
  return http.post<RunResponse>(`/api/v1/runs/${id}/rerun`);
}

/** 对比两次运行：后端按 node_id 对齐（F1） */
export async function compareRuns(a: string, b: string): Promise<RunCompareResult> {
  return http.get<RunCompareResult>(
    `/api/v1/runs/compare?ids=${encodeURIComponent(a)},${encodeURIComponent(b)}`,
  );
}

/** 运行列表的“按工作流筛选”下拉选项 */
export async function listWorkflowOptions(): Promise<WorkflowOption[]> {
  // 后端 /api/v1/workflows 没有 limit 参数（此前带 ?limit=200 会被静默忽略，评审 G24）
  const data = await http.get<WorkflowListData>('/api/v1/workflows');
  return data.items.map((item) => ({ id: item.id, name: item.name }));
}
