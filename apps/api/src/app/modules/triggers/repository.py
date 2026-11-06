"""TRIGGER-01：触发请求幂等记录的持久化。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tenancy import get_tenant, get_workspace_id
from app.modules.triggers.models import TriggerRequest


def _actor() -> str | None:
    tenant = get_tenant()
    return str(tenant.user_id) if tenant is not None else None


class TriggerRequestRepository:
    @staticmethod
    def get(
        session: Session,
        *,
        workflow_id: str,
        idempotency_key: str,
    ) -> TriggerRequest | None:
        q = session.query(TriggerRequest).filter(
            TriggerRequest.workflow_id == workflow_id,
            TriggerRequest.idempotency_key == idempotency_key,
            TriggerRequest.deleted_at.is_(None),
        )
        ws = get_workspace_id()
        if ws is not None:
            q = q.filter(TriggerRequest.workspace_id == str(ws))
        return q.first()

    @staticmethod
    def create(
        session: Session,
        *,
        workspace_id: str,
        workflow_id: str,
        idempotency_key: str,
        run_id: str,
    ) -> TriggerRequest:
        actor = _actor()
        obj = TriggerRequest(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            idempotency_key=idempotency_key,
            run_id=run_id,
            created_by=actor,
            updated_by=actor,
        )
        session.add(obj)
        session.flush()
        return obj
