"""Auth module models - User, Workspace, WorkspaceMember, ApiKey."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PgUUID  # noqa: N811
from sqlalchemy.types import TypeDecorator

from app.core.time import utcnow
from app.db.audit import AuditMixin
from app.db.database import Base


class UUIDType(TypeDecorator):
    """跨数据库的 UUID 类型：PostgreSQL 用原生 UUID，SQLite 用 CHAR(36)。"""

    impl = String(36)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PgUUID())
        return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        from uuid import UUID

        return UUID(value)


def _uuid():
    return str(uuid4())


# ── User ───────────────────────────────────────────────────────────


class User(AuditMixin, Base):
    __tablename__ = "user"

    id = Column(String(36), primary_key=True, default=_uuid, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(200), nullable=False)
    avatar_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    last_login_at = Column(DateTime, nullable=True)


# ── Workspace ─────────────────────────────────────────────────────


class Workspace(AuditMixin, Base):
    __tablename__ = "workspace"

    id = Column(String(36), primary_key=True, default=_uuid, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(String(36), ForeignKey("user.id"), nullable=False, index=True)
    plan = Column(String(20), default="free")  # free | pro | enterprise
    created_at = Column(DateTime, default=utcnow)


# ── WorkspaceMember ───────────────────────────────────────────────


class WorkspaceMember(AuditMixin, Base):
    __tablename__ = "workspace_member"

    workspace_id = Column(String(36), ForeignKey("workspace.id"), primary_key=True)
    user_id = Column(String(36), ForeignKey("user.id"), primary_key=True)
    role = Column(String(20), nullable=False, default="viewer")
    joined_at = Column(DateTime, default=utcnow)
    invited_by = Column(String(36), ForeignKey("user.id"), nullable=True)

    __table_args__ = (
        Index("ix_workspace_member_user", "user_id"),
        Index("ix_workspace_member_workspace", "workspace_id"),
    )


# ── ApiKey ─────────────────────────────────────────────────────────


class ApiKey(AuditMixin, Base):
    __tablename__ = "api_key"

    id = Column(String(36), primary_key=True, default=_uuid)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("user.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    # 外部 API Key：只存 sha256(secret)，明文仅在创建时返回一次
    key_hash = Column(String(255), nullable=False, index=True)
    # 形态固定为 af_<key_id>：既是可展示前缀，也是定位记录的唯一键
    key_prefix = Column(String(40), nullable=False, unique=True, index=True)
    enabled = Column(Boolean, default=True)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    expires_at = Column(DateTime, nullable=True)
