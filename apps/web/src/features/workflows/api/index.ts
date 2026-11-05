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
export type WorkflowVersionItem = components['schemas']['WorkflowVersionItem'];
export type WorkflowVersionDetail = components['schemas']['WorkflowVersionDetail'];

type WorkflowListData = ApiData<'/api/v1/workflows', 'get'>;
type RunListData = ApiData<'/api/v1/runs', 'get'>;
type RunDetail = components['schemas']['RunDetail'];
type ProviderListData = ApiData<'/api/v1/providers', 'get'>;

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
    `/api/v1/workflows${params.toString() ? `?${params.toString()}` : ''}`,
  );
  return data.items;
}

export async function getWorkflow(id: string): Promise<WorkflowResponse> {
  return http.get<WorkflowResponse>(`/api/v1/workflows/${id}`);
}

export async function createWorkflow(body: WorkflowCreate): Promise<WorkflowResponse> {
  return http.post<WorkflowResponse>('/api/v1/workflows', body);
}

export async function updateWorkflow(id: string, body: WorkflowUpdate): Promise<WorkflowResponse> {
  return http.put<WorkflowResponse>(`/api/v1/workflows/${id}`, body);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await http.delete(`/api/v1/workflows/${id}?confirm=true`);
}

export async function duplicateWorkflow(id: string): Promise<DuplicateResult> {
  return http.post<DuplicateResult>(`/api/v1/workflows/${id}/duplicate`);
}

export async function validateWorkflow(id?: string, graph?: unknown): Promise<ValidateResult> {
  if (id) return http.get<ValidateResult>(`/api/v1/workflows/${id}/validate`);
  return http.post<ValidateResult>('/api/v1/workflows/validate', graph);
}

/** 发起一次手动运行，返回 run_id（进度通过 SSE /api/v1/runs/{id}/events 观察） */
export async function runWorkflow(
  id: string,
  inputs: Record<string, unknown> = {},
): Promise<RunResponse> {
  return http.post<RunResponse>(`/api/v1/workflows/${id}/runs`, { inputs });
}

/** 单节点调试：只执行该节点，不写运行记录 */
export async function testNode(
  id: string,
  nodeId: string,
  payload: NodeTestRequest = {},
): Promise<NodeTestResult> {
  return http.post<NodeTestResult>(`/api/v1/workflows/${id}/nodes/${nodeId}/test`, payload);
}

/** 取消运行（runs 域接口，供编排侧调用） */
export async function cancelWorkflowRun(runId: string): Promise<CancelResult> {
  return http.post<CancelResult>(`/api/v1/runs/${runId}/cancel`);
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
  const list = await http.get<RunListData>(`/api/v1/runs?${params.toString()}`);
  const latest = list.items[0];
  if (!latest) return {};

  const detail = await http.get<RunDetail>(`/api/v1/runs/${latest.id}`);
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
  const data = await http.get<ProviderListData>('/api/v1/providers');
  return data.items;
}

/** 服务商可用模型列表（F3）：失败时返回空数组，界面仍允许手动输入 */
export async function listProviderModels(providerId: string): Promise<string[]> {
  const data = await http.get<{ items: string[] }>(`/api/v1/providers/${providerId}/models`);
  return data.items ?? [];
}

// ---- 首次引导专用（F4）：放在 workflows 的 api 层，避免直接依赖其他 feature 的 api ----

export type ProviderCreate = components['schemas']['ProviderCreate'];
export type ProviderTestResult = components['schemas']['ProviderTestResult'];

export async function createProviderForOnboarding(body: ProviderCreate): Promise<ProviderOption> {
  return http.post<ProviderOption>('/api/v1/providers', body);
}

export async function testProviderForOnboarding(body: ProviderCreate): Promise<ProviderTestResult> {
  return http.post<ProviderTestResult>('/api/v1/providers/test', body);
}

/** 轮询运行状态（引导里的示例运行用） */
export async function getRunStatus(runId: string): Promise<components['schemas']['RunDetail']> {
  return http.get<components['schemas']['RunDetail']>(`/api/v1/runs/${runId}`);
}

// ---- 版本历史（F5） ----

export async function listWorkflowVersions(id: string): Promise<WorkflowVersionItem[]> {
  const data = await http.get<{ items: WorkflowVersionItem[] }>(`/api/v1/workflows/${id}/versions`);
  return data.items ?? [];
}

export async function getWorkflowVersion(
  id: string,
  versionId: string,
): Promise<WorkflowVersionDetail> {
  return http.get<WorkflowVersionDetail>(`/api/v1/workflows/${id}/versions/${versionId}`);
}

export async function restoreWorkflowVersion(
  id: string,
  versionId: string,
): Promise<WorkflowResponse> {
  return http.post<WorkflowResponse>(`/api/v1/workflows/${id}/versions/${versionId}/restore`);
}

/** 导入工作流：confirm=false 预览重名处理，confirm=true 写入 */
export async function importWorkflows(
  payload: unknown,
  confirm = false,
): Promise<WorkflowImportResult> {
  return http.post<WorkflowImportResult>('/api/v1/workflows/import', { payload, confirm });
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
  const settings = await http.get<components['schemas']['SettingsResponse']>('/api/v1/settings');
  return toEditorPreferences(settings);
}
