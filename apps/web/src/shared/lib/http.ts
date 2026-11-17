/**
 * 轻量 HTTP 封装，统一解包后端的 { code, message, data } 响应。
 *
 * SaaS 能力：
 * - 自动注入 Authorization: Bearer <access_token>
 * - 401 时用 refresh_token 刷新一次后重放原请求
 * - 刷新期间并发请求排队，避免重复刷新
 * - 桌面模式（无 token）不注入
 */

import { useAuthStore } from '@/features/auth/hooks/useAuthStore';

const apiBase = () => import.meta.env.VITE_API_BASE_URL || '/api';
/**
 * API 基础路径：
 * - 完整 URL（http://https 开头）：直接用，Electron 打包模式（前后端分端口）
 * - 相对路径（/api 开头）：走 vite dev server 代理
 *
 * 历史实现里的 `apiBase().replace(/\/api$/, '')` 是错误的——它假设
 * VITE_API_BASE_URL 一定以 `/api` 结尾，但 Electron 打包时实际配的是
 * `http://127.0.0.1:12345`，末尾无 `/api`，replace 不生效导致绕过代理或拼错路径。
 */
const isFullUrl = (s: string) => /^https?:\/\//i.test(s);
const serviceBase = () => {
  const base = apiBase();
  return isFullUrl(base) ? base : '';
};

/** 从错误响应里尽量取出后端 message，取不到时退回 HTTP 状态码 */
async function toError(resp: Response): Promise<Error> {
  try {
    const body = await resp.json();
    if (body && typeof body.message === 'string' && body.message) {
      return new Error(body.message);
    }
  } catch {
    // 非 JSON 响应
  }
  return new Error(`HTTP ${resp.status}`);
}

/** 当前正在进行的 refresh Promise，用于并发请求排队 */
let refreshPromise: Promise<boolean> | null = null;

async function ensureToken(): Promise<string | null> {
  const { accessToken } = useAuthStore.getState();
  return accessToken;
}

/**
 * 401 处理：尝试刷新 token。
 * 并发请求共享同一个 refresh Promise，避免多次刷新。
 */
async function handle401(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const { refresh } = useAuthStore.getState();
    const ok = await refresh();
    return ok;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/** 判断是否为刷新 token 的请求（避免递归刷新） */
function isRefreshRequest(url: string): boolean {
  return url.includes('/auth/refresh');
}

/** 构建带 Authorization 头的 init */
async function withAuth(init?: RequestInit): Promise<RequestInit> {
  const token = await ensureToken();
  if (!token) return init || {};
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  };
}

/** 执行请求，处理 401 刷新重试 */
async function request<T>(url: string, init: RequestInit, retried = false): Promise<T> {
  const resp = await fetch(serviceBase() + url, init);

  if (resp.status === 401 && !isRefreshRequest(url) && !retried) {
    const refreshed = await handle401();
    if (refreshed) {
      // 用新 token 重新构建请求并重试
      const retryInit = await withAuth(init);
      return request<T>(url, { ...retryInit, method: init.method }, true);
    }
    // 刷新失败：跳登录
    const { logout } = useAuthStore.getState();
    await logout();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  if (!resp.ok) throw await toError(resp);
  const json = await resp.json();
  return json.data ?? json;
}

export const http = {
  get: async <T>(url: string, init?: RequestInit): Promise<T> => {
    const authInit = await withAuth(init);
    return request<T>(url, { ...authInit, method: 'GET' });
  },

  post: async <T>(url: string, body?: unknown, init?: RequestInit): Promise<T> => {
    const authInit = await withAuth({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      ...init,
    });
    return request<T>(url, authInit);
  },

  put: async <T>(url: string, body?: unknown): Promise<T> => {
    return http.post<T>(url, body, { method: 'PUT' });
  },

  patch: async <T>(url: string, body?: unknown): Promise<T> => {
    return http.post<T>(url, body, { method: 'PATCH' });
  },

  delete: async <T>(url: string): Promise<T> => {
    const authInit = await withAuth({ method: 'DELETE' });
    return request<T>(url, authInit);
  },
};

/** Construct SSE / 下载 URL, honoring Electron backend port if present. */
export function buildSseUrl(path: string): string {
  if (typeof window !== 'undefined' && window.electronAPI) {
    // Will be filled at runtime after getting backend port
    return path;
  }
  return `${serviceBase()}${path}`;
}

/** 拼接后端绝对/相对地址（用于 fetch 下载等非 JSON 场景） */
export const apiUrl = buildSseUrl;
