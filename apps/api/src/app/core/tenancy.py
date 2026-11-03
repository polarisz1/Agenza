"""SaaS 多租户基础设施：TenantContext + 多租户中间件 + tenant-aware session.

设计原则：
1. TenantContext 用 ContextVar 在线程/协程间传递（不污染函数签名）
2. TenantMiddleware 从 JWT 或 Header 提取 workspace_id，注入 TenantContext
3. 所有 Repository/Service 不需要知道 tenancy——session 自动带 workspace_id 过滤
4. 单用户本地模式（Electron 桌面版）自动降级：TenantMiddleware 为 no-op，
   TenantContext 默认 None，Repository 不注入 workspace 过滤
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID

from app.core.logger import log
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

# ── TenantContext ──────────────────────────────────────────────────

@dataclass
class TenantContext:
    """当前请求的租户上下文。

    桌面单用户模式下为 None（TENANCY_ENABLED=False）；
    SaaS 模式下由 TenantMiddleware 注入。
    """

    workspace_id: UUID
    user_id: UUID
    user_email: str
    role: str  # owner / editor / viewer / operator


_tenant_var: ContextVar[TenantContext | None] = ContextVar("tenant", default=None)


def get_tenant() -> TenantContext | None:
    """获取当前请求的租户上下文；单用户模式下返回 None。"""
    return _tenant_var.get()


def get_workspace_id() -> UUID | None:
    """便捷函数：只取 workspace_id。"""
    t = _tenant_var.get()
    return t.workspace_id if t else None


def set_tenant(tenant: TenantContext | None) -> None:
    """仅供中间件和测试代码调用。"""
    _tenant_var.set(tenant)


def clear_tenant() -> None:
    """请求结束后清理 ContextVar。"""
    _tenant_var.set(None)


# ── SaaS 模式开关 ──────────────────────────────────────────────────

def is_saas_mode() -> bool:
    """是否启用 SaaS 多租户模式。

    由环境变量 TENANCY_ENABLED 控制，默认 False（兼容桌面版）。
    """
    import os

    return os.environ.get("TENANCY_ENABLED", "false").lower() in ("1", "true", "yes")


# ── TenantMiddleware ───────────────────────────────────────────────

class TenantMiddleware(BaseHTTPMiddleware):
    """SaaS 模式的租户识别中间件。

    策略：从 Authorization: Bearer <jwt> 解析 workspace_id + user_id。
    桌面单用户模式（TENANCY_ENABLED=False）下此中间件不做任何事。
    """

    BYPASS_PATHS = {
        "/docs",
        "/redoc",
        "/openapi.json",
        "/health",
        "/",
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
    }

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        if not is_saas_mode():
            # 桌面版直通
            return await call_next(request)

        # Bypass 路径跳过
        path = request.url.path
        if any(path.startswith(p) for p in self.BYPASS_PATHS):
            return await call_next(request)

        tenant: TenantContext | None = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                tenant = _decode_jwt_tenant(auth_header[7:])
            except Exception as exc:
                log.warning(f"TenantMiddleware: JWT decode failed - {exc}")

        if tenant is None:
            return JSONResponse(
                status_code=401,
                content={"code": 401, "message": "Authentication required", "data": None},
            )

        set_tenant(tenant)
        try:
            response = await call_next(request)
        finally:
            clear_tenant()
        return response


def _decode_jwt_tenant(token: str) -> TenantContext:
    """从 JWT 解码租户信息（避免 Tenancy ↔ Auth 循环依赖，延迟 import）。"""
    from app.core.config import settings
    from jose import jwt

    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    return TenantContext(
        workspace_id=UUID(payload["wid"]),
        user_id=UUID(payload["sub"]),
        user_email=payload.get("email", ""),
        role=payload.get("role", "viewer"),
    )
