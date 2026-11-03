"""审计日志 repository"""

from __future__ import annotations

from collections.abc import Sequence

from app.core.tenancy import get_workspace_id
from app.modules.audit.models import AuditLog
from sqlalchemy import desc
from sqlalchemy.orm import Session


def _ws_id() -> str | None:
    ws = get_workspace_id()
    return str(ws) if ws is not None else None


class AuditRepository:
    @staticmethod
    def create(session: Session, log: AuditLog) -> AuditLog:
        if log.workspace_id is None:
            log.workspace_id = _ws_id()
        session.add(log)
        session.flush()
        return log

    @staticmethod
    def list(
        session: Session,
        action: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[Sequence[AuditLog], int]:
        q = session.query(AuditLog)
        ws = _ws_id()
        if ws is not None:
            q = q.filter(AuditLog.workspace_id == ws)
        if action:
            q = q.filter(AuditLog.action == action)
        total = q.count()
        items = q.order_by(desc(AuditLog.created_at)).offset(offset).limit(limit).all()
        return items, total
