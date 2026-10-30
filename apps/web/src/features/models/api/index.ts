import { http } from '@/shared/lib/http';
import type { ApiData, components } from '@agentflow/contracts';

export type ProviderResponse = components['schemas']['ProviderResponse'];
export type ProviderCreate = components['schemas']['ProviderCreate'];
export type ProviderUpdate = components['schemas']['ProviderUpdate'];
export type ProviderTestResult = components['schemas']['ProviderTestResult'];

type ProviderListData = ApiData<'/api/providers', 'get'>;

export async function listProviders(): Promise<ProviderResponse[]> {
  const data = await http.get<ProviderListData>('/api/providers');
  return data.items;
}

export async function createProvider(body: ProviderCreate): Promise<ProviderResponse> {
  return http.post<ProviderResponse>('/api/providers', body);
}

export async function updateProvider(id: string, body: ProviderUpdate): Promise<ProviderResponse> {
  return http.put<ProviderResponse>(`/api/providers/${id}`, body);
}

export async function deleteProvider(id: string): Promise<void> {
  await http.delete(`/api/providers/${id}`);
}

export async function testProvider(body: ProviderCreate): Promise<ProviderTestResult> {
  return http.post<ProviderTestResult>('/api/providers/test', body);
}
