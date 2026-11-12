"""Auth service - 注册/登录/JWT/密码哈希/工作空间创建."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.time import utcnow
from app.modules.auth.models import ApiKey, User
from app.modules.auth.repository import (
    ApiKeyRepository,
    UserRepository,
    WorkspaceMemberRepository,
    WorkspaceRepository,
)
from app.modules.auth.schemas import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyItem,
    ApiKeyListData,
    CurrentUserResponse,
    RegisterRequest,
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
        # 自托管安全默认：首个用户可注册，之后由 ALLOW_REGISTRATION 控制
        if not settings.ALLOW_REGISTRATION and session.query(User).count() > 0:
            raise AppError(403, "注册已关闭，请使用已有账号登录")

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

        # 审计日志：登录
        from app.modules.audit.service import log_action

        log_action(
            session,
            "user.login",
            user_id=user.id,
            user_email=user.email,
            workspace_id=default_ws.id,
            detail=f"登录工作空间 {default_ws.name}",
        )
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
            raise AppError(401, "刷新令牌无效或已过期") from None

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


# ── External API Keys ─────────────────────────────────────────────

_LAST_USED_THROTTLE = timedelta(seconds=60)


def _api_key_digest(secret: str) -> str:
    """Key 是高熵随机串，用确定性 sha256 便于按前缀查找后做常量时间比对。"""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _split_api_key(raw: str) -> tuple[str, str] | None:
    """`af_<key_id>_<secret>` → (key_prefix, secret)。"""
    parts = (raw or "").strip().split("_", 2)
    if len(parts) != 3 or parts[0] != "af" or not parts[1] or not parts[2]:
        return None
    return f"af_{parts[1]}", parts[2]


class ApiKeyService:
    """工作空间级 API Key：创建 / 列表 / 吊销 / 校验。"""

    @staticmethod
    def create(
        session: Session,
        *,
        workspace_id: str,
        user_id: str,
        body: ApiKeyCreateRequest,
    ) -> ApiKeyCreateResponse:
        key_id = secrets.token_hex(6)
        secret = secrets.token_urlsafe(32)
        raw_key = f"af_{key_id}_{secret}"
        prefix = f"af_{key_id}"
        expires_at = utcnow() + timedelta(days=body.expires_days) if body.expires_days else None
        obj = ApiKeyRepository.create(
            session,
            workspace_id=workspace_id,
            user_id=user_id,
            name=body.name,
            key_hash=_api_key_digest(secret),
            key_prefix=prefix,
            expires_at=expires_at,
        )
        session.commit()
        return ApiKeyCreateResponse(
            id=obj.id,
            name=obj.name,
            key_prefix=prefix,
            raw_key=raw_key,
            expires_at=obj.expires_at,
        )

    @staticmethod
    def list(session: Session, workspace_id: str) -> ApiKeyListData:
        items = [
            ApiKeyItem(
                id=key.id,
                name=key.name,
                key_prefix=key.key_prefix,
                enabled=bool(key.enabled),
                created_at=key.created_at,
                last_used_at=key.last_used_at,
                expires_at=key.expires_at,
            )
            for key in ApiKeyRepository.list(session, workspace_id)
        ]
        return ApiKeyListData(items=items)

    @staticmethod
    def revoke(session: Session, workspace_id: str, key_id: str) -> bool:
        ok = ApiKeyRepository.delete(session, key_id, workspace_id)
        session.commit()
        return ok

    @staticmethod
    def verify(session: Session, raw_key: str) -> tuple[ApiKey, User] | None:
        """校验外部 API Key；成功时返回 (key, user)，并顺带刷新 last_used_at。"""
        parsed = _split_api_key(raw_key)
        if parsed is None:
            return None
        prefix, secret = parsed
        key = ApiKeyRepository.get_by_prefix(session, prefix)
        if key is None or not key.enabled:
            return None
        if not hmac.compare_digest(key.key_hash, _api_key_digest(secret)):
            return None
        if key.expires_at is not None and key.expires_at < utcnow():
            return None
        user = UserRepository.get_by_id(session, key.user_id)
        if user is None or not user.is_active:
            return None

        now = utcnow()
        if key.last_used_at is None or now - key.last_used_at >= _LAST_USED_THROTTLE:
            key.last_used_at = now
            session.flush()
        return key, user


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
