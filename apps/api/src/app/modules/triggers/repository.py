"""TRIGGER-01：触发请求幂等记录的持久化。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tenancy import get_tenant, get_workspace_id
from app.core.time import utcnow
from app.modules.triggers.models import TriggerRequest, WorkflowTrigger


def _actor() -> str | None:
    tenant = get_tenant()
    return str(tenant.user_id) if tenant is not None else None


class TriggerRepository:
    """Webhook 触发器持久化；管理接口按 workspace 过滤，公网入口按 id 全局定位。"""

    @staticmethod
    def get(session: Session, trigger_id: str) -> WorkflowTrigger | None:
        q = session.query(WorkflowTrigger).filter(
            WorkflowTrigger.id == trigger_id,
            WorkflowTrigger.deleted_at.is_(None),
        )
        ws = get_workspace_id()
        if ws is not None:
            q = q.filter(WorkflowTrigger.workspace_id == str(ws))
        return q.first()

    @staticmethod
    def get_public(session: Session, trigger_id: str) -> WorkflowTrigger | None:
        """公网 Webhook 入口：此时还没有租户上下文，按 id 定位。"""
        return (
            session.query(WorkflowTrigger)
            .filter(
                WorkflowTrigger.id == trigger_id,
                WorkflowTrigger.deleted_at.is_(None),
            )
            .first()
        )

    @staticmethod
    def list(session: Session, workflow_id: str | None = None) -> list[WorkflowTrigger]:
        q = session.query(WorkflowTrigger).filter(WorkflowTrigger.deleted_at.is_(None))
        ws = get_workspace_id()
        if ws is not None:
            q = q.filter(WorkflowTrigger.workspace_id == str(ws))
        if workflow_id:
            q = q.filter(WorkflowTrigger.workflow_id == workflow_id)
        return q.order_by(WorkflowTrigger.created_at.desc()).all()

    @staticmethod
    def create(
        session: Session,
        *,
        workspace_id: str,
        workflow_id: str,
        name: str,
        secret_enc: str,
        input_mapping: str | None,
        enabled: bool,
    ) -> WorkflowTrigger:
        actor = _actor()
        obj = WorkflowTrigger(
            workspace_id=workspace_id,
            workflow_id=workflow_id,
            name=name,
            secret_enc=secret_enc,
            input_mapping=input_mapping,
            enabled=enabled,
            created_by=actor,
            updated_by=actor,
        )
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def update(session: Session, obj: WorkflowTrigger, fields: dict) -> WorkflowTrigger:
        for key, value in fields.items():
            setattr(obj, key, value)
        obj.updated_by = _actor()
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, obj: WorkflowTrigger) -> None:
        obj.deleted_at = utcnow()
        obj.enabled = False
        obj.updated_by = _actor()
        session.flush()

    @staticmethod
    def touch(session: Session, obj: WorkflowTrigger) -> None:
        obj.last_triggered_at = utcnow()
        session.flush()


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
