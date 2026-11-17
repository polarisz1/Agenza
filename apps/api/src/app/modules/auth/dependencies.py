"""Auth dependency functions - get_current_user, require_role, require_workspace_access."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.config import settings
from app.core.tenancy import TenantContext, set_tenant
from app.modules.auth.models import User, Workspace
from app.modules.auth.repository import UserRepository
from app.modules.auth.service import ApiKeyService


def _decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.effective_jwt_secret,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None


def _extract_bearer(request: Request) -> str | None:
    """从 Authorization 头取 Bearer token。

    注意：这里必须是同步函数。之前写成 `async def`，而所有调用处都是直接
    `token = _extract_bearer(request)`，拿到的是 coroutine 对象而非字符串，
    传给 PyJWT 的 jwt.decode 就会抛 AttributeError，表现为登录后
    /api/v1/auth/me、/api/v1/workspaces 全部 500。
    """
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    """SaaS 模式：从 JWT 解析用户。"""
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = _decode_access_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("sub")
    user = UserRepository.get_by_id(session, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def get_current_workspace(
    request: Request,
    session: Session = Depends(get_session),
) -> Workspace:
    """从 JWT 解析 workspace_id，返回 Workspace 实体。"""
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = _decode_access_token(token)
    workspace_id = payload.get("wid")

    from app.modules.auth.models import Workspace

    ws = (
        session.query(Workspace)
        .filter(Workspace.id == workspace_id, Workspace.deleted_at.is_(None))
        .first()
    )
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return ws


def get_current_role(request: Request) -> str:
    """从 JWT 直接解析角色（无需 DB 查询）。"""
    token = _extract_bearer(request)
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    payload = _decode_access_token(token)
    return payload.get("role", "viewer")


def require_role(*roles: str):
    """角色守卫——只有指定角色才能访问。

    用法：Depends(require_role("owner", "editor"))
    """

    def _check(request: Request):
        current = get_current_role(request)
        if current not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Requires role: {' or '.join(roles)}",
            )
        return current

    return _check


@dataclass(frozen=True)
class ApiKeyContext:
    """外部 API Key 解析结果；租户上下文已写入 ContextVar。"""

    key_id: str
    workspace_id: str
    user_id: str


async def require_api_key(
    request: Request,
    session: Session = Depends(get_session),
) -> ApiKeyContext:
    """`X-API-Key` 认证，供 HTTP/Webhook 触发使用。

    必须是 async 依赖：ContextVar 在 anyio 线程池里设置不会回传到事件循环，
    而同步端点是在线程池里执行的，会导致工作空间上下文丢失。
    清理租户上下文由 `TenantMiddleware` 的公开触发路径分支负责，
    这样内层 AuditMiddleware 仍能拿到 workspace/user。
    """
    raw = request.headers.get("x-api-key", "").strip()
    if not raw:
        raise HTTPException(status_code=401, detail="Missing API key")

    result = ApiKeyService.verify(session, raw)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid or expired API key")

    key, user = result
    set_tenant(
        TenantContext(
            workspace_id=UUID(key.workspace_id),
            user_id=UUID(key.user_id),
            user_email=user.email,
            role="editor",
        )
    )
    return ApiKeyContext(key_id=key.id, workspace_id=key.workspace_id, user_id=key.user_id)


def optional_auth(
    request: Request,
    session: Session = Depends(get_session),
) -> User | None:
    """可选认证——有 token 就解析，没有也不报错。"""
    token = _extract_bearer(request)
    if not token:
        return None
    try:
        payload = _decode_access_token(token)
        return UserRepository.get_by_id(session, payload.get("sub"))
    except Exception:
        return None
