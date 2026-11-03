import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore, useIsAuthenticated } from '@/features/auth/hooks/useAuthStore';

interface AuthGuardProps {
  children: ReactNode;
}

/**
 * 路由守卫：
 * - 未登录 → 跳 /login
 * - 已登录 → 放行
 * - 桌面模式（无 token）→ 始终放行
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const isAuthenticated = useIsAuthenticated();
  const isDesktop = useAuthStore((s) => s.isDesktop);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 桌面模式下直接进入，不需要 workspace 选择
  if (isDesktop) {
    return <>{children}</>;
  }

  return <>{children}</>;
}
