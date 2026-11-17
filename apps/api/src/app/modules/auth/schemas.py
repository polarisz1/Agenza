"""Auth Pydantic schemas - OpenAPI 单一事实源。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

UserRole = Literal["owner", "editor", "viewer", "operator"]


# ── Register / Login ──────────────────────────────────────────────


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    # 可选：同时创建一个工作空间
    workspace_name: str | None = Field(default=None, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    user: UserProfile
    workspace_id: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


# ── User Profile ──────────────────────────────────────────────────


class UserProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    email: str
    name: str
    avatar_url: str | None = None
    is_active: bool = True
    created_at: datetime | None = None
    last_login_at: datetime | None = None


class WorkspaceSummary(BaseModel):
    id: str
    name: str
    role: UserRole
    plan: str = "free"
    member_count: int = 0
    created_at: datetime | None = None


class WorkspaceListData(BaseModel):
    items: list[WorkspaceSummary]


class CurrentUserResponse(BaseModel):
    user: UserProfile
    workspaces: list[WorkspaceSummary]


# ── Workspace Member ──────────────────────────────────────────────


class MemberItem(BaseModel):
    user_id: str
    email: str
    name: str
    avatar_url: str | None = None
    role: UserRole
    joined_at: datetime
    invited_by_name: str | None = None


class MemberListData(BaseModel):
    items: list[MemberItem]


class InviteMemberRequest(BaseModel):
    email: EmailStr
    role: UserRole = "viewer"


class UpdateMemberRoleRequest(BaseModel):
    role: UserRole


# ── ApiKey ─────────────────────────────────────────────────────────


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    expires_days: int | None = Field(default=None, ge=1, le=365)


class ApiKeyItem(BaseModel):
    id: str
    name: str
    key_prefix: str
    enabled: bool
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime | None = None


class ApiKeyCreateResponse(BaseModel):
    id: str
    name: str
    key_prefix: str
    raw_key: str  # 只在创建时返回一次明文
    expires_at: datetime | None = None


class ApiKeyListData(BaseModel):
    items: list[ApiKeyItem]
