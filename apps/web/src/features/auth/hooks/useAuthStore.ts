import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as authApi from '../api';
import type { UserProfile } from '../api';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  /** 当前默认工作空间 id（登录/注册时由后端返回，用于登录后直接进入） */
  workspaceId: string | null;
  /** 桌面模式标记：无 token 时视为已登录（单用户） */
  isDesktop: boolean;

  setTokens: (access: string, refresh: string) => void;
  setUser: (user: UserProfile | null) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
  /** 登录成功后返回默认工作空间 id（可能为 null） */
  login: (email: string, password: string) => Promise<string | null>;
  /** 注册成功后返回自动创建的工作空间 id（可能为 null） */
  register: (
    email: string,
    password: string,
    name: string,
    workspaceName?: string,
  ) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  fetchMe: () => Promise<void>;
}

/** 是否处于桌面单用户模式（无后端 SaaS 鉴权） */
function detectDesktop(): boolean {
  // VITE_DESKTOP_MODE 由桌面打包时注入；开发期默认 false
  return import.meta.env.VITE_DESKTOP_MODE === 'true';
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      workspaceId: null,
      isDesktop: detectDesktop(),

      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      setUser: (user) => set({ user }),
      setWorkspaceId: (workspaceId) => set({ workspaceId }),

      login: async (email, password) => {
        const resp = await authApi.login({ email, password });
        set({
          accessToken: resp.access_token,
          refreshToken: resp.refresh_token,
          user: resp.user,
          workspaceId: resp.workspace_id ?? null,
        });
        return resp.workspace_id ?? null;
      },

      register: async (email, password, name, workspaceName) => {
        const resp = await authApi.register({ email, password, name, workspace_name: workspaceName });
        set({
          accessToken: resp.access_token,
          refreshToken: resp.refresh_token,
          user: resp.user,
          workspaceId: resp.workspace_id ?? null,
        });
        return resp.workspace_id ?? null;
      },

      logout: async () => {
        try {
          await authApi.logout();
        } catch {
          // 网络错误时也清除本地状态
        }
        set({ accessToken: null, refreshToken: null, user: null, workspaceId: null });
      },

      refresh: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const resp = await authApi.refreshToken(refreshToken);
          set({
            accessToken: resp.access_token,
            refreshToken: resp.refresh_token,
            user: resp.user,
            workspaceId: resp.workspace_id ?? get().workspaceId,
          });
          return true;
        } catch {
          set({ accessToken: null, refreshToken: null, user: null });
          return false;
        }
      },

      fetchMe: async () => {
        try {
          const user = await authApi.getMe();
          set({ user });
        } catch {
          // token 无效时清空
          set({ accessToken: null, refreshToken: null, user: null });
        }
      },
    }),
    {
      name: 'agentflow-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        workspaceId: state.workspaceId,
      }),
    },
  ),
);

/** 判断当前是否已登录（桌面模式始终为 true） */
export function useIsAuthenticated(): boolean {
  const { accessToken, isDesktop } = useAuthStore();
  return isDesktop || !!accessToken;
}
