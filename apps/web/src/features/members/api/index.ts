import { http } from '@/shared/lib/http';
import type { components } from '@agenza/contracts';

export type WorkspaceMemberItem = components['schemas']['WorkspaceMemberItem'];
export type MemberInviteRequest = components['schemas']['MemberInviteRequest'];
export type MemberRoleUpdate = components['schemas']['MemberRoleUpdate'];

type MemberListPayload = WorkspaceMemberItem[] | { items: WorkspaceMemberItem[] };

export async function listMembers(wsId: string): Promise<WorkspaceMemberItem[]> {
  const data = await http.get<MemberListPayload>(`/api/v1/workspaces/${wsId}/members`);
  return Array.isArray(data) ? data : (data.items ?? []);
}

export async function inviteMember(
  wsId: string,
  body: MemberInviteRequest,
): Promise<WorkspaceMemberItem> {
  return http.post<WorkspaceMemberItem>(`/api/v1/workspaces/${wsId}/members`, body);
}

export async function updateMemberRole(
  wsId: string,
  userId: string,
  body: MemberRoleUpdate,
): Promise<WorkspaceMemberItem> {
  return http.put<WorkspaceMemberItem>(
    `/api/v1/workspaces/${wsId}/members/${encodeURIComponent(userId)}`,
    body,
  );
}

export async function removeMember(wsId: string, userId: string): Promise<void> {
  await http.delete(`/api/v1/workspaces/${wsId}/members/${encodeURIComponent(userId)}`);
}
