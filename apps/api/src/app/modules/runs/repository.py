"""Run repository."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.modules.runs.models import NodeRun, Run


class RunRepository:
    @staticmethod
    def create(session: Session, obj: Run) -> Run:
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def get(session: Session, run_id: str) -> Run | None:
        return session.get(Run, run_id)

    @staticmethod
    def list(
        session: Session,
        workflow_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
        started_after: datetime | None = None,
        started_before: datetime | None = None,
    ) -> list[Run]:
        q = session.query(Run)
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
    def update(session: Session, run_id: str, **fields) -> Run | None:
        obj = session.get(Run, run_id)
        if obj is None:
            return None
        for k, v in fields.items():
            setattr(obj, k, v)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def add_node_run(session: Session, obj: NodeRun) -> NodeRun:
        session.add(obj)
        session.flush()
        return obj

    @staticmethod
    def list_node_runs(session: Session, run_id: str) -> list[NodeRun]:
        return (
            session.query(NodeRun)
            .filter(NodeRun.run_id == run_id)
            .order_by(NodeRun.started_at.asc(), NodeRun.id)
            .all()
        )

    @staticmethod
    def get_node_run(session: Session, run_id: str, node_id: str) -> NodeRun | None:
        return (
            session.query(NodeRun)
            .filter(NodeRun.run_id == run_id, NodeRun.node_id == node_id)
            .first()
        )

    @staticmethod
    def delete_by_workflow(session: Session, workflow_id: str) -> None:
        session.query(NodeRun).filter(
            NodeRun.run_id.in_(
                [r.id for r in session.query(Run).filter(Run.workflow_id == workflow_id).all()]
            )
        ).delete(synchronize_session=False)
        session.query(Run).filter(Run.workflow_id == workflow_id).delete()
        session.flush()

    # ---- 运行保留策略 ----

    @staticmethod
    def list_older_run_ids(session: Session, workflow_id: str, keep: int) -> list[str]:
        """返回需要清理的运行 id：按开始时间倒序，超出 keep 的旧记录。"""
        rows = (
            session.query(Run.id)
            .filter(Run.workflow_id == workflow_id)
            .order_by(Run.started_at.desc())
            .offset(max(0, keep))
            .all()
        )
        return [row[0] for row in rows]

    @staticmethod
    def count(session: Session) -> int:
        return session.query(Run).count()

    @staticmethod
    def clear_all(session: Session) -> int:
        """清空全部运行记录，同时清掉节点级记录（否则留下孤儿数据，评审 S7）。"""
        count = session.query(Run).count()
        session.query(NodeRun).delete(synchronize_session=False)
        session.query(Run).delete(synchronize_session=False)
        session.flush()
        return count

    @staticmethod
    def delete_runs(session: Session, run_ids: list[str]) -> None:
        if not run_ids:
            return
        session.query(NodeRun).filter(NodeRun.run_id.in_(run_ids)).delete(synchronize_session=False)
        session.query(Run).filter(Run.id.in_(run_ids)).delete(synchronize_session=False)
        session.flush()
