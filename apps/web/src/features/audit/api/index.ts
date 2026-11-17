import { http } from '@/shared/lib/http';
import type { components } from '@agenza/contracts';

export type AuditLogItem = components['schemas']['AuditLogItem'];
export type AuditLogListResponse = components['schemas']['AuditLogListResponse'];

export interface AuditLogQuery {
  action?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogListResponse> {
  const params = new URLSearchParams();
  if (query.action) params.set('action', query.action);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.offset) params.set('offset', String(query.offset));
  return http.get<AuditLogListResponse>(
    `/api/v1/audit-logs${params.toString() ? `?${params.toString()}` : ''}`,
  );
}
