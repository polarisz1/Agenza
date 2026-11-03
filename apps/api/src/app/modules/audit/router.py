"""审计日志 router"""

from __future__ import annotations

from app.db.database import get_db
from app.modules.audit.repository import AuditRepository
from app.modules.audit.schemas import AuditLogItem, AuditLogListResponse
from fastapi import APIRouter, Depends, Query

router = APIRouter(prefix="/audit-logs", tags=["v1-audit-logs"])


@router.get("", response_model=AuditLogListResponse)
def list_audit_logs(
    action: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session=Depends(get_db),
):
    items, total = AuditRepository.list(session, action=action, limit=limit, offset=offset)
    return AuditLogListResponse(
        items=[AuditLogItem.model_validate(item) for item in items],
        total=total,
    )
