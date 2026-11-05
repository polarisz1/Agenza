"""Workflow repository - SQLAlchemy queries.

SaaS 多租户：所有查询显式带 workspace_id 过滤；写操作记录 workspace_id + created_by。
桌面模式（TENANCY_ENABLED=false）下 workspace_id 为 None，查询不过滤、不写入。
"""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.core.tenancy import get_tenant, get_workspace_id
from app.core.time import utcnow
from app.modules.workflows.models import Workflow, WorkflowVersion


def _ws_id() -> str | None:
    """当前请求的 workspace_id（字符串形式）；桌面模式返回 None。"""
    ws = get_workspace_id()
    return str(ws) if ws is not None else None


def _user_id() -> str | None:
    """当前请求的 user_id；桌面模式返回 None。"""
    t = get_tenant()
    return str(t.user_id) if t is not None else None


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
            workspace_id=_ws_id(),
            created_by=_user_id(),
            updated_by=_user_id(),
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
        q = session.query(Workflow).filter(
            Workflow.id == wf_id, Workflow.deleted_at.is_(None)
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Workflow.workspace_id == ws)
        return q.first()

    @staticmethod
    def list(
        session: Session,
        q: str | None = None,
        status: str | None = None,
        sort: str = "updated_desc",
    ) -> tuple[Sequence[Workflow], int]:
        query = session.query(Workflow).filter(Workflow.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            query = query.filter(Workflow.workspace_id == ws)
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
        obj = WorkflowRepository.get(session, wf_id)
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
        actor = _user_id()
        if actor is not None:
            obj.updated_by = actor
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, wf_id: str) -> bool:
        """软删除（DB-05）：保留工作流及其历史，列表/详情不再返回。"""
        obj = WorkflowRepository.get(session, wf_id)
        if obj is None:
            return False
        obj.deleted_at = utcnow()
        actor = _user_id()
        if actor is not None:
            obj.updated_by = actor
        session.flush()
        return True

    @staticmethod
    def mark_run(session: Session, wf_id: str) -> None:
        obj = WorkflowRepository.get(session, wf_id)
        if obj is None:
            return
        obj.last_run_at = utcnow()
        session.flush()

    # ---- 版本快照（F5） ----

    @staticmethod
    def create_version(session: Session, version: WorkflowVersion) -> WorkflowVersion:
        # 版本继承工作流的 workspace_id 与操作者
        if version.workspace_id is None:
            version.workspace_id = _ws_id()
        if version.created_by is None:
            version.created_by = _user_id()
        if version.updated_by is None:
            version.updated_by = version.created_by
        session.add(version)
        session.flush()
        session.refresh(version)
        return version

    @staticmethod
    def list_versions(session: Session, workflow_id: str) -> list[WorkflowVersion]:
        q = session.query(WorkflowVersion).filter(
            WorkflowVersion.workflow_id == workflow_id,
            WorkflowVersion.deleted_at.is_(None),
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(WorkflowVersion.workspace_id == ws)
        return q.order_by(WorkflowVersion.seq.desc()).all()

    @staticmethod
    def latest_version(session: Session, workflow_id: str) -> WorkflowVersion | None:
        q = session.query(WorkflowVersion).filter(
            WorkflowVersion.workflow_id == workflow_id,
            WorkflowVersion.deleted_at.is_(None),
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(WorkflowVersion.workspace_id == ws)
        return q.order_by(WorkflowVersion.seq.desc()).first()

    @staticmethod
    def get_version(session: Session, workflow_id: str, version_id: str) -> WorkflowVersion | None:
        q = session.query(WorkflowVersion).filter(
            WorkflowVersion.workflow_id == workflow_id,
            WorkflowVersion.id == version_id,
            WorkflowVersion.deleted_at.is_(None),
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(WorkflowVersion.workspace_id == ws)
        return q.first()

    @staticmethod
    def prune_versions(session: Session, workflow_id: str, keep: int = 50) -> None:
        q = (
            session.query(WorkflowVersion.id)
            .filter(WorkflowVersion.workflow_id == workflow_id)
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(WorkflowVersion.workspace_id == ws)
        olds = q.order_by(WorkflowVersion.seq.desc()).offset(max(1, keep)).all()
        ids = [row[0] for row in olds]
        if ids:
            session.query(WorkflowVersion).filter(WorkflowVersion.id.in_(ids)).delete(
                synchronize_session=False
            )
            session.flush()
