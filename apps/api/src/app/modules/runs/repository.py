"""Run repository.

SaaS 多租户：所有查询显式带 workspace_id 过滤；写操作记录 workspace_id + triggered_by。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.core.tenancy import get_tenant, get_workspace_id
from app.modules.runs.models import NodeRun, Run, RunDeepAnalysis


def _ws_id() -> str | None:
    ws = get_workspace_id()
    return str(ws) if ws is not None else None


def _user_id() -> str | None:
    t = get_tenant()
    return str(t.user_id) if t is not None else None


class RunRepository:
    @staticmethod
    def create(session: Session, obj: Run) -> Run:
        if obj.workspace_id is None:
            obj.workspace_id = _ws_id()
        if obj.triggered_by is None:
            obj.triggered_by = _user_id()
        if obj.created_by is None:
            obj.created_by = obj.triggered_by
        if obj.updated_by is None:
            obj.updated_by = obj.triggered_by
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def get(session: Session, run_id: str) -> Run | None:
        q = session.query(Run).filter(Run.id == run_id, Run.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        return q.first()

    @staticmethod
    def list(
        session: Session,
        workflow_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
        started_after: datetime | None = None,
        started_before: datetime | None = None,
    ) -> list[Run]:
        q = session.query(Run).filter(Run.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        if workflow_id:
            q = q.filter(Run.workflow_id == workflow_id)
        if status:
            q = q.filter(Run.status == status)
        if started_after:
            q = q.filter(Run.started_at >= started_after)
        if started_before:
            q = q.filter(Run.started_at <= started_before)
        return q.order_by(Run.started_at.desc()).limit(limit).all()

    @staticmethod
    def list_children(session: Session, parent_run_id: str, limit: int = 100) -> list[Run]:
        q = session.query(Run).filter(Run.parent_run_id == parent_run_id, Run.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        return q.order_by(Run.started_at.asc()).limit(limit).all()

    @staticmethod
    def update(session: Session, run_id: str, **fields) -> Run | None:
        obj = RunRepository.get(session, run_id)
        if obj is None:
            return None
        for k, v in fields.items():
            setattr(obj, k, v)
        actor = _user_id()
        if actor is not None:
            obj.updated_by = actor
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def add_node_run(session: Session, obj: NodeRun) -> NodeRun:
        if obj.workspace_id is None:
            obj.workspace_id = _ws_id()
        user_id = _user_id()
        if obj.created_by is None:
            obj.created_by = user_id
        if obj.updated_by is None:
            obj.updated_by = user_id
        session.add(obj)
        session.flush()
        return obj

    @staticmethod
    def list_node_runs(session: Session, run_id: str) -> list[NodeRun]:
        q = session.query(NodeRun).filter(NodeRun.run_id == run_id, NodeRun.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            q = q.filter(NodeRun.workspace_id == ws)
        return q.order_by(NodeRun.started_at.asc(), NodeRun.id).all()

    @staticmethod
    def get_node_run(session: Session, run_id: str, node_id: str) -> NodeRun | None:
        q = session.query(NodeRun).filter(
            NodeRun.run_id == run_id,
            NodeRun.node_id == node_id,
            NodeRun.deleted_at.is_(None),
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(NodeRun.workspace_id == ws)
        return q.first()

    @staticmethod
    def delete_by_workflow(session: Session, workflow_id: str) -> None:
        ws = _ws_id()
        run_q = session.query(Run).filter(Run.workflow_id == workflow_id)
        if ws is not None:
            run_q = run_q.filter(Run.workspace_id == ws)
        run_ids = [r.id for r in run_q.all()]
        if run_ids:
            session.query(NodeRun).filter(NodeRun.run_id.in_(run_ids)).delete(
                synchronize_session=False
            )
            session.query(RunDeepAnalysis).filter(RunDeepAnalysis.run_id.in_(run_ids)).delete(
                synchronize_session=False
            )
        session.query(Run).filter(Run.id.in_(run_ids)).delete(synchronize_session=False)
        session.flush()

    # ---- 运行保留策略 ----

    @staticmethod
    def list_older_run_ids(session: Session, workflow_id: str, keep: int) -> list[str]:
        """返回需要清理的运行 id：按开始时间倒序，超出 keep 的旧记录。"""
        q = session.query(Run.id).filter(Run.workflow_id == workflow_id)
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        rows = q.order_by(Run.started_at.desc()).offset(max(0, keep)).all()
        return [row[0] for row in rows]

    @staticmethod
    def count(session: Session) -> int:
        q = session.query(Run)
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        return q.count()

    @staticmethod
    def clear_all(session: Session) -> int:
        """清空当前 workspace 的全部运行记录，同时清掉节点级记录。"""
        q = session.query(Run)
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        count = q.count()
        run_ids = [r.id for r in q.all()]
        if run_ids:
            session.query(NodeRun).filter(NodeRun.run_id.in_(run_ids)).delete(
                synchronize_session=False
            )
            session.query(RunDeepAnalysis).filter(RunDeepAnalysis.run_id.in_(run_ids)).delete(
                synchronize_session=False
            )
            session.query(Run).filter(Run.id.in_(run_ids)).delete(synchronize_session=False)
        session.flush()
        return count

    @staticmethod
    def delete_runs(session: Session, run_ids: list[str]) -> None:
        if not run_ids:
            return
        ws = _ws_id()
        q = session.query(Run).filter(Run.id.in_(run_ids))
        if ws is not None:
            q = q.filter(Run.workspace_id == ws)
        actual_ids = [r.id for r in q.all()]
        if actual_ids:
            session.query(NodeRun).filter(NodeRun.run_id.in_(actual_ids)).delete(
                synchronize_session=False
            )
            session.query(RunDeepAnalysis).filter(RunDeepAnalysis.run_id.in_(actual_ids)).delete(
                synchronize_session=False
            )
            session.query(Run).filter(Run.id.in_(actual_ids)).delete(synchronize_session=False)
            session.flush()


class RunDeepAnalysisRepository:
    """AI 深度分析结果的持久化与缓存查询（GATE-04 Phase 2）。"""

    @staticmethod
    def get_by_run(session: Session, run_id: str) -> RunDeepAnalysis | None:
        q = session.query(RunDeepAnalysis).filter(
            RunDeepAnalysis.run_id == run_id,
            RunDeepAnalysis.deleted_at.is_(None),
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(RunDeepAnalysis.workspace_id == ws)
        return q.first()

    @staticmethod
    def upsert(session: Session, run_id: str, fields: dict) -> RunDeepAnalysis:
        """同一运行只保留一条分析结果；refresh 时覆盖旧结果，避免重复计费。"""
        obj = RunDeepAnalysisRepository.get_by_run(session, run_id)
        if obj is None:
            obj = RunDeepAnalysis(
                workspace_id=_ws_id(),
                run_id=run_id,
                created_by=_user_id(),
                updated_by=_user_id(),
                **fields,
            )
            session.add(obj)
        else:
            for key, value in fields.items():
                setattr(obj, key, value)
            obj.updated_by = _user_id()
        session.flush()
        session.refresh(obj)
        return obj
