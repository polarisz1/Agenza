import { http } from '@/shared/lib/http';
import type { components } from '@agentflow/contracts';

export type LoginRequest = components['schemas']['LoginRequest'];
export type RegisterRequest = components['schemas']['RegisterRequest'];
export type TokenResponse = components['schemas']['TokenResponse'];
export type UserProfile = components['schemas']['UserProfile'];

/** 注册新用户，返回 token */
export async function register(body: RegisterRequest): Promise<TokenResponse> {
  return http.post<TokenResponse>('/api/v1/auth/register', body);
}

/** 登录，返回 token */
export async function login(body: LoginRequest): Promise<TokenResponse> {
  return http.post<TokenResponse>('/api/v1/auth/login', body);
}

/** 用 refresh token 换取新的 access token */
export async function refreshToken(refreshToken: string): Promise<TokenResponse> {
  return http.post<TokenResponse>('/api/v1/auth/refresh', { refresh_token: refreshToken });
}

/** 获取当前用户信息 */
export async function getMe(): Promise<UserProfile> {
  return http.get<UserProfile>('/api/v1/auth/me');
}

/** 登出 */
export async function logout(): Promise<void> {
  await http.post<void>('/api/v1/auth/logout', {});
}
