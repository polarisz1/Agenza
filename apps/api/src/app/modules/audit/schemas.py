"""审计日志 schemas"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AuditLogItem(BaseModel):
    id: str
    workspace_id: str | None = None
    user_id: str | None = None
    user_email: str | None = None
    action: str
    resource_type: str | None = None
    resource_id: str | None = None
    ip: str | None = None
    detail: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogListResponse(BaseModel):
    items: list[AuditLogItem]
    total: int
