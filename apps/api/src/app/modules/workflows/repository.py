"""Workflow repository - SQLAlchemy queries."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.modules.workflows.models import Workflow, WorkflowVersion

# utcnow 用于 last_run_at


class WorkflowRepository:
    @staticmethod
    def create(
        session: Session,
        wf_id: str,
        name: str,
        description: str | None,
        graph_json: str,
        status: str = "draft",
    ) -> Workflow:
        obj = Workflow(
            id=wf_id,
            name=name,
            description=description,
            graph_json=graph_json,
            status=status,
        )
        session.add(obj)
        session.flush()
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
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, wf_id: str) -> bool:
        obj = session.get(Workflow, wf_id)
        if obj is None:
            return False
        session.delete(obj)
        session.flush()
        return True

    @staticmethod
    def mark_run(session: Session, wf_id: str) -> None:
        obj = session.get(Workflow, wf_id)
        if obj is None:
            return
        obj.last_run_at = utcnow()
        session.flush()

    # ---- 版本快照（F5） ----

    @staticmethod
    def create_version(session: Session, version: WorkflowVersion) -> WorkflowVersion:
        session.add(version)
        session.flush()
        session.refresh(version)
        return version

    @staticmethod
    def list_versions(session: Session, workflow_id: str) -> list[WorkflowVersion]:
        return (
            session.query(WorkflowVersion)
            .filter(WorkflowVersion.workflow_id == workflow_id)
            .order_by(WorkflowVersion.seq.desc())
            .all()
        )

    @staticmethod
    def latest_version(session: Session, workflow_id: str) -> WorkflowVersion | None:
        return (
            session.query(WorkflowVersion)
            .filter(WorkflowVersion.workflow_id == workflow_id)
            .order_by(WorkflowVersion.seq.desc())
            .first()
        )

    @staticmethod
    def get_version(session: Session, workflow_id: str, version_id: str) -> WorkflowVersion | None:
        return (
            session.query(WorkflowVersion)
            .filter(
                WorkflowVersion.workflow_id == workflow_id,
                WorkflowVersion.id == version_id,
            )
            .first()
        )

    @staticmethod
    def prune_versions(session: Session, workflow_id: str, keep: int = 50) -> None:
        olds = (
            session.query(WorkflowVersion.id)
            .filter(WorkflowVersion.workflow_id == workflow_id)
            .order_by(WorkflowVersion.seq.desc())
            .offset(max(1, keep))
            .all()
        )
        ids = [row[0] for row in olds]
        if ids:
            session.query(WorkflowVersion).filter(WorkflowVersion.id.in_(ids)).delete(
                synchronize_session=False
            )
            session.flush()
