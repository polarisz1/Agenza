"""Auth service - 注册/登录/JWT/密码哈希/工作空间创建."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import HTTPException
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logger import log
from app.core.time import utcnow
from app.modules.auth.models import User
from app.modules.auth.repository import (
    ApiKeyRepository,
    UserRepository,
    WorkspaceMemberRepository,
    WorkspaceRepository,
)
from app.modules.auth.schemas import (
    CurrentUserResponse,
    RegisterRequest,
    RefreshRequest,
    TokenResponse,
    UserProfile,
    WorkspaceSummary,
)

# ── Password Hashing ─────────────────────────────────────────────

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT ───────────────────────────────────────────────────────────

def create_access_token(*, user_id: str, email: str, workspace_id: str, role: str) -> str:
    from jose import jwt

    expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "email": email,
        "wid": workspace_id,
        "role": role,
        "type": "access",
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.effective_jwt_secret, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(*, user_id: str) -> str:
    from jose import jwt

    expire = datetime.utcnow() + timedelta(days=settings.JWT_REFRESH_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.effective_jwt_secret, algorithm=settings.JWT_ALGORITHM)


# ── AuthService ──────────────────────────────────────────────────

class AuthService:
    @staticmethod
    def register(session: Session, body: RegisterRequest) -> TokenResponse:
        """注册 + 可选自动创建工作空间 + 自动登录返回 Token。"""
        existing = UserRepository.get_by_email(session, body.email)
        if existing:
            raise AppError(409, "该邮箱已注册")

        user = UserRepository.create(
            session,
            email=body.email.lower(),
            password_hash=hash_password(body.password),
            name=body.name,
        )

        # 自动创建默认工作空间（名同用户名）
        ws_name = body.workspace_name or f"{body.name} 的工作空间"
        workspace = WorkspaceRepository.create(
            session, name=ws_name, owner_id=user.id, description="默认工作空间"
        )

        UserRepository.update_login(session, user.id)
        session.commit()

        token = create_access_token(
            user_id=user.id, email=user.email, workspace_id=workspace.id, role="owner"
        )
        refresh = create_refresh_token(user_id=user.id)

        return TokenResponse(
            access_token=token,
            refresh_token=refresh,
            expires_in=settings.JWT_EXPIRE_MINUTES * 60,
            user=_to_user_profile(user),
            workspace_id=workspace.id,
        )

    @staticmethod
    def login(session: Session, email: str, password: str) -> TokenResponse:
        user = UserRepository.get_by_email(session, email.lower())
        if user is None or not verify_password(password, user.password_hash):
            raise AppError(401, "邮箱或密码不正确")
        if not user.is_active:
            raise AppError(403, "账号已停用")

        # 取第一个工作空间作为默认
        workspaces = WorkspaceRepository.list_by_user(session, user.id)
        if not workspaces:
            raise AppError(403, "您还没有加入任何工作空间")

        default_ws = workspaces[0]
        member = WorkspaceMemberRepository.get(session, default_ws.id, user.id)
        if member is None:
            raise AppError(403, "无法访问该工作空间")

        UserRepository.update_login(session, user.id)
        session.commit()

        token = create_access_token(
            user_id=user.id,
            email=user.email,
            workspace_id=default_ws.id,
            role=member.role,
        )
        refresh = create_refresh_token(user_id=user.id)

        return TokenResponse(
            access_token=token,
            refresh_token=refresh,
            expires_in=settings.JWT_EXPIRE_MINUTES * 60,
            user=_to_user_profile(user),
            workspace_id=default_ws.id,
        )

    @staticmethod
    def refresh(session: Session, refresh_token: str) -> TokenResponse:
        from jose import jwt

        try:
            payload = jwt.decode(
                refresh_token, settings.effective_jwt_secret, algorithms=[settings.JWT_ALGORITHM]
            )
        except Exception:
            raise AppError(401, "刷新令牌无效或已过期")

        if payload.get("type") != "refresh":
            raise AppError(401, "令牌类型错误")

        user_id = payload.get("sub")
        user = UserRepository.get_by_id(session, user_id)
        if user is None or not user.is_active:
            raise AppError(401, "用户不存在或已停用")

        workspaces = WorkspaceRepository.list_by_user(session, user.id)
        if not workspaces:
            raise AppError(403, "您还没有加入任何工作空间")

        default_ws = workspaces[0]
        member = WorkspaceMemberRepository.get(session, default_ws.id, user.id)

        token = create_access_token(
            user_id=user.id,
            email=user.email,
            workspace_id=default_ws.id,
            role=member.role if member else "viewer",
        )

        return TokenResponse(
            access_token=token,
            refresh_token=refresh_token,  # 复用（有状态 token 可在此处轮换）
            expires_in=settings.JWT_EXPIRE_MINUTES * 60,
            user=_to_user_profile(user),
            workspace_id=default_ws.id,
        )

    @staticmethod
    def current_user(session: Session, user_id: str) -> CurrentUserResponse:
        user = UserRepository.get_by_id(session, user_id)
        if user is None:
            raise AppError(404, "用户不存在")

        workspace_objs = WorkspaceRepository.list_by_user(session, user.id)
        summaries: list[WorkspaceSummary] = []
        for ws in workspace_objs:
            member = WorkspaceMemberRepository.get(session, ws.id, user.id)
            count = WorkspaceRepository.member_count(session, ws.id)
            summaries.append(
                WorkspaceSummary(
                    id=ws.id,
                    name=ws.name,
                    role=member.role if member else "viewer",
                    plan=ws.plan,
                    member_count=count,
                    created_at=ws.created_at,
                )
            )

        return CurrentUserResponse(user=_to_user_profile(user), workspaces=summaries)


def _to_user_profile(u: User) -> UserProfile:
    return UserProfile(
        id=u.id,
        email=u.email,
        name=u.name,
        avatar_url=u.avatar_url,
        is_active=u.is_active,
        created_at=u.created_at,
        last_login_at=u.last_login_at,
    )
