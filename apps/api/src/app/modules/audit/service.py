"""审计日志 service"""

from __future__ import annotations

from app.core.tenancy import get_tenant
from app.modules.audit.models import AuditLog
from app.modules.audit.repository import AuditRepository
from sqlalchemy.orm import Session


def log_action(
    session: Session,
    action: str,
    *,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
    workspace_id: str | None = None,
) -> None:
    """记录一条审计日志。

    优先使用显式传入的 user_id/workspace_id（如登录时尚无租户上下文），
    否则从 TenantContext 自动获取。
    """
    tenant = get_tenant()
    resolved_user_id = user_id or (str(tenant.user_id) if tenant else None)
    resolved_user_email = user_email or (tenant.email if tenant else None)

    log = AuditLog(
        user_id=resolved_user_id,
        user_email=resolved_user_email,
        workspace_id=workspace_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=detail,
        ip=ip,
        user_agent=user_agent,
    )
    AuditRepository.create(session, log)
