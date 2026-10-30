import { apiUrl, http } from '@/shared/lib/http';
import type { components } from '@agentflow/contracts';

export type SettingsResponse = components['schemas']['SettingsResponse'];
export type SystemInfo = components['schemas']['SystemInfo'];
export type ClearResult = components['schemas']['ClearResult'];
export type WorkflowImportResult = components['schemas']['WorkflowImportResult'];

export async function getSettings(): Promise<SettingsResponse> {
  return http.get<SettingsResponse>('/api/settings');
}

export async function updateSettings(
  data: Partial<SettingsResponse>,
): Promise<SettingsResponse> {
  return http.put<SettingsResponse>('/api/settings', data);
}

export async function getSystemInfo(): Promise<SystemInfo> {
  return http.get<SystemInfo>('/api/settings/system/info');
}

export async function clearRuns(): Promise<ClearResult> {
  return http.post<ClearResult>('/api/settings/system/clear-runs');
}

/** 导出备份（设置 + 工作流，不含服务商密钥），浏览器直接下载 JSON 文件 */
export async function exportBackup(): Promise<void> {
  const resp = await fetch(apiUrl('/api/settings/system/export'));
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
  return http.post<WorkflowImportResult>('/api/workflows/import', { payload, confirm });
}
