import { http } from '@/shared/lib/http';
import type { ApiData, components } from '@agenza/contracts';

export type GatewayConfig = components['schemas']['GatewayConfigResponse'];
export type GatewayConfigUpdate = components['schemas']['GatewayConfigUpdate'];
export type GatewayRoute = components['schemas']['GatewayRouteItem'];
export type GatewayRouteUpsert = components['schemas']['GatewayRouteUpsert'];
export type GatewayUsage = components['schemas']['GatewayUsageResponse'];
export type GatewayModelStat = components['schemas']['GatewayModelStat'];
export type GatewayResolve = components['schemas']['GatewayResolveResponse'];
export type TaskType = GatewayRoute['task_type'];
export type ProviderOption = components['schemas']['ProviderResponse'];

export async function getGatewayConfig(): Promise<GatewayConfig> {
  return http.get<ApiData<'/api/v1/gateway/config', 'get'>>('/api/v1/gateway/config');
}

export async function updateGatewayConfig(body: GatewayConfigUpdate): Promise<GatewayConfig> {
  return http.put<ApiData<'/api/v1/gateway/config', 'put'>>('/api/v1/gateway/config', body);
}

export async function listGatewayRoutes(): Promise<GatewayRoute[]> {
  const data = await http.get<ApiData<'/api/v1/gateway/routes', 'get'>>('/api/v1/gateway/routes');
  return data.items ?? [];
}

/** 按 task_type upsert：同一任务类型只会保留一条策略 */
export async function upsertGatewayRoute(body: GatewayRouteUpsert): Promise<GatewayRoute> {
  return http.post<ApiData<'/api/v1/gateway/routes', 'post'>>('/api/v1/gateway/routes', body);
}

export async function deleteGatewayRoute(routeId: string): Promise<void> {
  await http.delete(`/api/v1/gateway/routes/${routeId}`);
}

export async function getGatewayUsage(days = 30): Promise<GatewayUsage> {
  return http.get<ApiData<'/api/v1/gateway/usage', 'get'>>(`/api/v1/gateway/usage?days=${days}`);
}

export async function resolveGatewayModel(taskType: TaskType): Promise<GatewayResolve> {
  return http.get<ApiData<'/api/v1/gateway/resolve', 'get'>>(
    `/api/v1/gateway/resolve?task_type=${taskType}`,
  );
}

/** 服务商下拉：Gateway 自己的 API 层，避免直接依赖其他 feature */
export async function listProviderOptions(): Promise<ProviderOption[]> {
  const data = await http.get<ApiData<'/api/v1/providers', 'get'>>('/api/v1/providers');
  return data.items ?? [];
}
