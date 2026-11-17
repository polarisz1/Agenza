import { http } from '@/shared/lib/http';
import type { ApiData, components } from '@agenza/contracts';

export type ProviderResponse = components['schemas']['ProviderResponse'];
export type ProviderCreate = components['schemas']['ProviderCreate'];
export type ProviderUpdate = components['schemas']['ProviderUpdate'];
export type ProviderTestResult = components['schemas']['ProviderTestResult'];

type ProviderListData = ApiData<'/api/v1/providers', 'get'>;

export async function listProviders(): Promise<ProviderResponse[]> {
  const data = await http.get<ProviderListData>('/api/v1/providers');
  return data.items;
}

export async function createProvider(body: ProviderCreate): Promise<ProviderResponse> {
  return http.post<ProviderResponse>('/api/v1/providers', body);
}

export async function updateProvider(id: string, body: ProviderUpdate): Promise<ProviderResponse> {
  return http.put<ProviderResponse>(`/api/v1/providers/${id}`, body);
}

export async function deleteProvider(id: string): Promise<void> {
  await http.delete(`/api/v1/providers/${id}`);
}

export async function testProvider(body: ProviderCreate): Promise<ProviderTestResult> {
  return http.post<ProviderTestResult>('/api/v1/providers/test', body);
}

/** 测试已保存的服务商：密钥由后端从库里解密，前端不接触明文（F5）。 */
export async function testProviderById(id: string): Promise<ProviderTestResult> {
  return http.post<ProviderTestResult>(`/api/v1/providers/${id}/test`);
}
