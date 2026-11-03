"""Auth dependency functions - get_current_user, require_role, require_workspace_access."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.config import settings
from app.core.tenancy import TenantContext, get_tenant, is_saas_mode
from app.modules.auth.models import User, Workspace
from app.modules.auth.repository import UserRepository, WorkspaceMemberRepository


def _decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            settings.effective_jwt_secret,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def _extract_bearer(request: Request) -> str | None:
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

    ws = session.get(Workspace, workspace_id)
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
