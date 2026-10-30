/** 轻量 HTTP 封装，统一解包后端的 { code, message, data } 响应 */
const apiBase = () => import.meta.env.VITE_API_BASE_URL || '/api';
const serviceBase = () => apiBase().replace(/\/api$/, '');

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

export const http = {
  get: async <T>(url: string, init?: RequestInit): Promise<T> => {
    const resp = await fetch(serviceBase() + url, init);
    if (!resp.ok) throw await toError(resp);
    const json = await resp.json();
    return json.data ?? json;
  },
  post: async <T>(url: string, body?: any, init?: RequestInit): Promise<T> => {
    const resp = await fetch(serviceBase() + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      ...init,
    });
    if (!resp.ok) throw await toError(resp);
    const json = await resp.json();
    return json.data ?? json;
  },
  put: async <T>(url: string, body?: any): Promise<T> => http.post(url, body, { method: 'PUT' }),
  delete: async <T>(url: string): Promise<T> => {
    const resp = await fetch(serviceBase() + url, { method: 'DELETE' });
    if (!resp.ok) throw await toError(resp);
    const json = await resp.json();
    return json.data ?? json;
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
