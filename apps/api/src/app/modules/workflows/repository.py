"""Workflow repository - SQLAlchemy queries."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.modules.workflows.models import Workflow

# utcnow 用于 last_run_at


class WorkflowRepository:
    @staticmethod
    def create(
        session: Session, wf_id: str, name: str, description: str | None, graph_json: str
    ) -> Workflow:
        obj = Workflow(id=wf_id, name=name, description=description, graph_json=graph_json)
        session.add(obj)
        session.commit()
        session.refresh(obj)
        return obj

    @staticmethod
    def get(session: Session, wf_id: str) -> Workflow | None:
        return session.get(Workflow, wf_id)

    @staticmethod
    def list(
        session: Session,
        q: str | None = None,
        status: str | None = None,
        sort: str = "updated_desc",
    ) -> tuple[Sequence[Workflow], int]:
        query = session.query(Workflow)
        if q:
            query = query.filter(Workflow.name.ilike(f"%{q}%"))
        if status:
            query = query.filter(Workflow.status == status)
        total = query.count()
        if sort == "updated_desc":
            query = query.order_by(Workflow.updated_at.desc())
        elif sort == "last_run_desc":
            query = query.order_by(Workflow.last_run_at.desc().nullslast())
        return query.all(), total

    @staticmethod
    def update(
        session: Session,
        wf_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        graph_json: str | None = None,
        viewport_json: str | None = None,
        status: str | None = None,
    ) -> Workflow | None:
        obj = session.get(Workflow, wf_id)
        if obj is None:
            return None
        if name is not None:
            obj.name = name
        if description is not None:
            obj.description = description
        if graph_json is not None:
            obj.graph_json = graph_json
        if viewport_json is not None:
            obj.viewport_json = viewport_json
        if status is not None:
            obj.status = status
        session.commit()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, wf_id: str) -> bool:
        obj = session.get(Workflow, wf_id)
        if obj is None:
            return False
        session.delete(obj)
        session.commit()
        return True

    @staticmethod
    def mark_run(session: Session, wf_id: str) -> None:
        obj = session.get(Workflow, wf_id)
        if obj is None:
            return
        obj.last_run_at = utcnow()
        session.commit()
