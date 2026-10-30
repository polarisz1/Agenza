import { http } from '@/shared/lib/http';
import type { ApiData, components } from '@agentflow/contracts';

export type WorkflowListItem = components['schemas']['WorkflowListItem'];
export type WorkflowResponse = components['schemas']['WorkflowResponse'];
export type WorkflowCreate = components['schemas']['WorkflowCreate'];
export type WorkflowUpdate = components['schemas']['WorkflowUpdate'];
export type ValidateResult = components['schemas']['ValidateResult'];
export type DuplicateResult = components['schemas']['DuplicateResult'];
export type NodeTestResult = components['schemas']['NodeTestResult'];
export type NodeTestRequest = components['schemas']['NodeTestRequest'];
export type RunResponse = components['schemas']['RunResponse'];
export type CancelResult = components['schemas']['CancelResult'];
export type WorkflowImportItem = components['schemas']['WorkflowImportItem'];
export type WorkflowImportResult = components['schemas']['WorkflowImportResult'];

type WorkflowListData = ApiData<'/api/workflows', 'get'>;
type RunListData = ApiData<'/api/runs', 'get'>;
type RunDetail = components['schemas']['RunDetail'];
type ProviderListData = ApiData<'/api/providers', 'get'>;

export type ProviderOption = components['schemas']['ProviderResponse'];

export async function listWorkflows(
  q?: string,
  status?: string,
  sort?: string,
): Promise<WorkflowListItem[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (sort) params.set('sort', sort);
  const data = await http.get<WorkflowListData>(
    `/api/workflows${params.toString() ? `?${params.toString()}` : ''}`,
  );
  return data.items;
}

export async function getWorkflow(id: string): Promise<WorkflowResponse> {
  return http.get<WorkflowResponse>(`/api/workflows/${id}`);
}

export async function createWorkflow(body: WorkflowCreate): Promise<WorkflowResponse> {
  return http.post<WorkflowResponse>('/api/workflows', body);
}

export async function updateWorkflow(id: string, body: WorkflowUpdate): Promise<WorkflowResponse> {
  return http.put<WorkflowResponse>(`/api/workflows/${id}`, body);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await http.delete(`/api/workflows/${id}?confirm=true`);
}

export async function duplicateWorkflow(id: string): Promise<DuplicateResult> {
  return http.post<DuplicateResult>(`/api/workflows/${id}/duplicate`);
}

export async function validateWorkflow(id?: string, graph?: unknown): Promise<ValidateResult> {
  if (id) return http.get<ValidateResult>(`/api/workflows/${id}/validate`);
  return http.post<ValidateResult>('/api/workflows/validate', graph);
}

/** 发起一次手动运行，返回 run_id（进度通过 SSE /api/runs/{id}/events 观察） */
export async function runWorkflow(
  id: string,
  inputs: Record<string, unknown> = {},
): Promise<RunResponse> {
  return http.post<RunResponse>(`/api/workflows/${id}/runs`, { inputs });
}

/** 单节点调试：只执行该节点，不写运行记录 */
export async function testNode(
  id: string,
  nodeId: string,
  payload: NodeTestRequest = {},
): Promise<NodeTestResult> {
  return http.post<NodeTestResult>(`/api/workflows/${id}/nodes/${nodeId}/test`, payload);
}

/** 取消运行（runs 域接口，供编排侧调用） */
export async function cancelWorkflowRun(runId: string): Promise<CancelResult> {
  return http.post<CancelResult>(`/api/runs/${runId}/cancel`);
}

/**
 * 最近一次成功运行的节点输出（单节点调试上游 / 可用变量推断 / 属性面板“最近输出”）。
 * 走 workflows 自己的 API 模块，避免直接依赖 features/runs 的 api。
 */
export async function getLatestRunNodeOutputs(
  workflowId: string,
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    workflow_id: workflowId,
    status: 'success',
    limit: '1',
  });
  const list = await http.get<RunListData>(`/api/runs?${params.toString()}`);
  const latest = list.items[0];
  if (!latest) return {};

  const detail = await http.get<RunDetail>(`/api/runs/${latest.id}`);
  const outputs: Record<string, unknown> = {};
  for (const node of detail.nodes) {
    if (node.status === 'success' && node.output !== null && node.output !== undefined) {
      outputs[node.node_id] = node.output;
    }
  }
  return outputs;
}

/** LLM / 抽取节点的服务商下拉选项 */
export async function listProviderOptions(): Promise<ProviderOption[]> {
  const data = await http.get<ProviderListData>('/api/providers');
  return data.items;
}

/** 导入工作流：confirm=false 预览重名处理，confirm=true 写入 */
export async function importWorkflows(
  payload: unknown,
  confirm = false,
): Promise<WorkflowImportResult> {
  return http.post<WorkflowImportResult>('/api/workflows/import', { payload, confirm });
}

export interface EditorPreferences {
  /** 编辑时是否自动保存（对应设置页的「自动保存」开关） */
  autoSave: boolean;
}

/** 把后端设置映射成编辑器偏好；缺省或异常一律按"开启"处理（保持旧行为）。 */
export function toEditorPreferences(settings: { auto_save?: unknown } | null): EditorPreferences {
  return { autoSave: settings?.auto_save !== false };
}

/**
 * 读取编辑器偏好。
 *
 * 放在本 feature 自己的 api 层，避免直接 import `features/settings/api`
 * （AGENTS §3.1 禁止 feature 之间互相依赖）。
 */
export async function getEditorPreferences(): Promise<EditorPreferences> {
  const settings = await http.get<components['schemas']['SettingsResponse']>('/api/settings');
  return toEditorPreferences(settings);
}
