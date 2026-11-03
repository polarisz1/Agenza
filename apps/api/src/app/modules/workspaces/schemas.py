"""Workspaces module schemas - 成员管理 + 工作空间 CRUD."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

UserRole = str  # 复用 auth module 的定义；API 层不需要严格字面量


class WorkspaceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None


class WorkspaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    owner_id: str
    owner_name: str | None = None
    plan: str = "free"
    member_count: int = 0
    my_role: str = "owner"
    created_at: datetime | None = None


class WorkspaceMemberItem(BaseModel):
    user_id: str
    email: str
    name: str
    avatar_url: str | None = None
    role: str
    joined_at: datetime
    invited_by_name: str | None = None


class MemberInviteRequest(BaseModel):
    email: str
    role: str = "viewer"


class MemberRoleUpdate(BaseModel):
    role: str


class WorkspaceListData(BaseModel):
    items: list[WorkspaceResponse]
