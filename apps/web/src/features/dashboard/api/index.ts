import { http } from '@/shared/lib/http';
import type { components } from '@agentflow/contracts';

type RunListItem = components['schemas']['RunListItem'];
type WorkflowListItem = components['schemas']['WorkflowListItem'];

/** 获取运行记录列表（用于 Dashboard 聚合） */
export async function fetchDashboardRuns(): Promise<RunListItem[]> {
  const data = await http.get<{ items: RunListItem[] }>('/api/runs?limit=200');
  return data.items ?? [];
}

/** 获取工作流列表（用于 Dashboard 热门工作流） */
export async function fetchDashboardWorkflows(): Promise<WorkflowListItem[]> {
  const data = await http.get<{ items: WorkflowListItem[] }>('/api/workflows?limit=100');
  return data.items ?? [];
}
