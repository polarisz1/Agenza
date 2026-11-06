import { apiUrl, http } from '@/shared/lib/http';
import type { ApiData, components } from '@agentflow/contracts';

export type SettingsResponse = components['schemas']['SettingsResponse'];
export type SettingsUpdate = components['schemas']['SettingsUpdate'];
export type SystemInfo = components['schemas']['SystemInfo'];
export type ClearResult = components['schemas']['ClearResult'];
export type WorkflowImportResult = components['schemas']['WorkflowImportResult'];
export type WorkspaceSummary = components['schemas']['WorkspaceResponse'];
export type ApiKeyItem = components['schemas']['ApiKeyItem'];
export type ApiKeyCreateRequest = components['schemas']['ApiKeyCreateRequest'];
export type ApiKeyCreateResponse = components['schemas']['ApiKeyCreateResponse'];

export async function getSettings(): Promise<SettingsResponse> {
  return http.get<SettingsResponse>('/api/v1/settings');
}

export async function updateSettings(data: SettingsUpdate): Promise<SettingsResponse> {
  return http.put<SettingsResponse>('/api/v1/settings', data);
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return http.get<SystemInfo>('/api/v1/settings/system/info');
}

/** 工作空间摘要：计划、成员数（设置页用量概览） */
export async function getWorkspaceSummary(wsId: string): Promise<WorkspaceSummary> {
  return http.get<WorkspaceSummary>(`/api/v1/workspaces/${wsId}`);
}

export async function clearRuns(): Promise<ClearResult> {
  return http.post<ClearResult>('/api/v1/settings/system/clear-runs');
}

/** 导出备份（设置 + 工作流，不含服务商密钥），浏览器直接下载 JSON 文件 */
export async function exportBackup(): Promise<void> {
  const resp = await fetch(apiUrl('/api/v1/settings/system/export'));
  if (!resp.ok) throw new Error(`导出失败（HTTP ${resp.status}）`);

  const disposition = resp.headers.get('content-disposition') || '';
  const matched = /filename="?([^";]+)"?/.exec(disposition);
  const filename = matched?.[1] || `agentflow-backup-${Date.now()}.json`;

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 导入工作流：confirm=false 预览（含重名副本命名），confirm=true 写入 */
export async function importWorkflows(
  payload: unknown,
  confirm = false,
): Promise<WorkflowImportResult> {
  return http.post<WorkflowImportResult>('/api/v1/workflows/import', { payload, confirm });
}

// ── API Key（外部 HTTP 触发凭据，仅 owner 可管理） ────────────────

export async function listApiKeys(): Promise<ApiKeyItem[]> {
  const data = await http.get<ApiData<'/api/v1/api-keys', 'get'>>('/api/v1/api-keys');
  return data.items ?? [];
}

/** 创建后 `raw_key` 只返回一次，前端必须在关闭弹窗后丢弃 */
export async function createApiKey(body: ApiKeyCreateRequest): Promise<ApiKeyCreateResponse> {
  return http.post<ApiKeyCreateResponse>('/api/v1/api-keys', body);
}

export async function revokeApiKey(keyId: string): Promise<void> {
  await http.delete(`/api/v1/api-keys/${encodeURIComponent(keyId)}`);
}
