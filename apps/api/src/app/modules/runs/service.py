"""Run service - orchestrates engine + repository."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.engine.contexts import NodeResult
from app.core.engine.manager import RunManager, get_run_manager
from app.core.engine.validators import validate_graph
from app.core.exceptions import AppException
from app.core.logger import log
from app.core.providers import get_providers_registry
from app.db.database import SessionLocal
from app.modules.runs.models import NodeRun, Run
from app.modules.runs.repository import RunRepository
from app.modules.runs.schemas import (
    NodeRunDetail,
    RunDetail,
    RunListItem,
    RunResponse,
)
from app.modules.workflows.service import WorkflowService


class RunService:
    @staticmethod
    async def start_run(
        session: Session,
        workflow_id: str,
        inputs: dict,
        trigger: str = "manual",
    ) -> RunResponse:
        wf = WorkflowService.get(session, workflow_id)
        if not wf:
            raise AppException(404, "Workflow not found")
        return await RunService._start(session, wf, wf.graph, inputs, trigger)

    @staticmethod
    async def rerun(session: Session, run_id: str) -> RunResponse:
        """基于历史运行的图快照 + 输入重新发起一次运行。"""
        run = RunRepository.get(session, run_id)
        if not run:
            raise AppException(404, "Run not found")

        try:
            graph = json.loads(run.graph_snapshot)
            inputs = json.loads(run.inputs_json) if run.inputs_json else {}
        except Exception as exc:  # noqa: BLE001
            raise AppException(422, f"Invalid run snapshot: {exc}") from exc

        wf = WorkflowService.get(session, run.workflow_id)
        if not wf:
            raise AppException(404, "Workflow not found")

        return await RunService._start(session, wf, graph, inputs, "manual")

    # ---- Internal ----

    @staticmethod
    async def _start(
        session: Session,
        wf: Any,
        graph: dict,
        inputs: dict,
        trigger: str,
    ) -> RunResponse:
        # 同一工作流默认串行：已有运行中则拒绝（TBD 多实例并发的默认策略）
        running = RunRepository.list(session, workflow_id=wf.id, status="running", limit=1)
        if running:
            raise AppException(409, "Workflow already has a running run")

        if not graph.get("nodes"):
            raise AppException(422, "Workflow is empty")

        check = validate_graph(nodes=graph.get("nodes", []), edges=graph.get("edges", []))
        if not check["ok"]:
            issues = "; ".join(i["message"] for i in check["issues"])
            raise AppException(422, f"Invalid graph: {issues}")

        missing = [
            f["key"]
            for f in graph.get("inputs", [])
            if f.get("required") and f["key"] not in (inputs or {})
        ]
        if missing:
            raise AppException(400, f"Missing required inputs: {', '.join(missing)}")

        run_id = f"r_{uuid.uuid4().hex[:10]}"
        run = Run(
            id=run_id,
            workflow_id=wf.id,
            workflow_name=wf.name,
            graph_snapshot=json.dumps(graph, ensure_ascii=False),
            inputs_json=json.dumps(inputs or {}, ensure_ascii=False),
            status="running",
            trigger=trigger,
            started_at=datetime.utcnow(),
        )
        RunRepository.create(session, run)

        providers_registry = get_providers_registry(session)
        manager: RunManager = get_run_manager()

        await manager.start_run(
            run_id=run_id,
            graph=graph,
            inputs=inputs or {},
            providers_registry=providers_registry,
            on_node_started=_make_node_started(run_id),
            on_node_finished=_make_node_finished(run_id),
            on_run_finished=_make_run_finished(run_id, wf.id),
        )

        return RunResponse(
            id=run.id,
            workflow_id=run.workflow_id,
            workflow_name=run.workflow_name,
            status="running",
            trigger=run.trigger,
            started_at=run.started_at,
        )

    @staticmethod
    def list(
        session: Session,
        workflow_id: str | None = None,
        status: str | None = None,
        limit: int = 100,
        started_after: datetime | None = None,
        started_before: datetime | None = None,
    ) -> list[RunListItem]:
        runs = RunRepository.list(
            session,
            workflow_id=workflow_id,
            status=status,
            limit=limit,
            started_after=started_after,
            started_before=started_before,
        )
        return [
            RunListItem(
                id=r.id,
                workflow_id=r.workflow_id,
                workflow_name=r.workflow_name,
                status=r.status,
                trigger=r.trigger,
                started_at=r.started_at,
                finished_at=r.finished_at,
                duration_ms=r.duration_ms,
            )
            for r in runs
        ]

    @staticmethod
    def get(session: Session, run_id: str) -> RunDetail | None:
        run = RunRepository.get(session, run_id)
        if not run:
            return None
        nodes = RunRepository.list_node_runs(session, run_id)
        return RunDetail(
            id=run.id,
            workflow_id=run.workflow_id,
            workflow_name=run.workflow_name,
            status=run.status,
            trigger=run.trigger,
            started_at=run.started_at,
            finished_at=run.finished_at,
            duration_ms=run.duration_ms,
            total_tokens=run.total_tokens or 0,
            error=run.error,
            nodes=[_to_node_detail(nr) for nr in nodes],
        )

    @staticmethod
    def get_node(session: Session, run_id: str, node_id: str) -> NodeRunDetail | None:
        nr = RunRepository.get_node_run(session, run_id, node_id)
        if not nr:
            return None
        return _to_node_detail(nr)

    @staticmethod
    def latest_node_outputs(session: Session, workflow_id: str) -> dict[str, Any]:
        """最近一次成功运行的节点输出（单节点调试的上游来源）。"""
        runs = RunRepository.list(session, workflow_id=workflow_id, status="success", limit=1)
        if not runs:
            return {}
        outputs: dict[str, Any] = {}
        for nr in RunRepository.list_node_runs(session, runs[0].id):
            if nr.status == "success" and nr.output_json:
                try:
                    outputs[nr.node_id] = json.loads(nr.output_json)
                except Exception:  # noqa: BLE001
                    continue
        return outputs

    @staticmethod
    async def cancel(run_id: str) -> bool:
        manager = get_run_manager()
        return await manager.cancel_run(run_id)


def _to_node_detail(nr: NodeRun) -> NodeRunDetail:
    output: Any = None
    if nr.output_json:
        try:
            output = json.loads(nr.output_json)
        except Exception:  # noqa: BLE001
            output = nr.output_json
    return NodeRunDetail(
        id=nr.id,
        node_id=nr.node_id,
        node_type=nr.node_type,
        node_name=nr.node_name,
        status=nr.status,
        attempt=nr.attempt or 1,
        started_at=nr.started_at,
        finished_at=nr.finished_at,
        output=output,
        error=nr.error,
        model=nr.model,
        tokens_in=nr.tokens_in or 0,
        tokens_out=nr.tokens_out or 0,
        duration_ms=nr.duration_ms or 0,
    )


# ---- Engine callbacks（每次独立 Session，避免复用已关闭的请求级 Session）----

def _make_node_started(run_id: str):
    async def _on_node_started(node_id: str, node: dict) -> None:
        nr_id = f"nr_{uuid.uuid4().hex[:14]}"
        node_type = node.get("type") or "unknown"
        node_name = node.get("name") or node_id
        try:
            with SessionLocal() as db:
                db.add(
                    NodeRun(
                        id=nr_id,
                        run_id=run_id,
                        node_id=node_id,
                        node_type=node_type,
                        node_name=node_name,
                        status="running",
                        attempt=1,
                        started_at=datetime.utcnow(),
                        duration_ms=0,
                    )
                )
                db.commit()
        except Exception:  # noqa: BLE001
            log.exception(f"Failed to persist node start {run_id}/{node_id}")

    return _on_node_started


def _make_node_finished(run_id: str):
    async def _on_node_finished(
        node_id: str, node: dict, result: NodeResult, duration_ms: int
    ) -> None:
        try:
            with SessionLocal() as db:
                nr = RunRepository.get_node_run(db, run_id, node_id)
                if nr is None:
                    # 节点未启动就结束（跳过 / 取消）
                    nr = NodeRun(
                        id=f"nr_{uuid.uuid4().hex[:14]}",
                        run_id=run_id,
                        node_id=node_id,
                        node_type=node.get("type") or "unknown",
                        node_name=node.get("name") or node_id,
                        status=result.status,
                        attempt=1,
                        started_at=datetime.utcnow(),
                    )
                    db.add(nr)
                nr.status = result.status
                nr.finished_at = datetime.utcnow()
                nr.duration_ms = duration_ms
                nr.tokens_in = result.tokens_in
                nr.tokens_out = result.tokens_out
                nr.model = result.model
                nr.error = result.error
                nr.output_json = (
                    json.dumps(result.output, ensure_ascii=False, default=str)
                    if result.output is not None
                    else None
                )
                db.commit()
        except Exception:  # noqa: BLE001
            log.exception(f"Failed to persist node finish {run_id}/{node_id}")

    return _on_node_finished


def _make_run_finished(run_id: str, workflow_id: str):
    async def _on_run_finished(
        _run_id: str,
        status: str,
        error: str | None,
        duration_ms: int,
        total_tokens: int,
    ) -> None:
        try:
            with SessionLocal() as db:
                RunRepository.update(
                    db,
                    run_id,
                    status=status,
                    error=error,
                    finished_at=datetime.utcnow(),
                    duration_ms=duration_ms,
                    total_tokens=total_tokens,
                )
                WorkflowService.mark_run(db, workflow_id)
                # 保留策略：每个工作流只保留最近 RUN_RETENTION 条运行
                keep = max(1, settings.RUN_RETENTION)
                old_ids = RunRepository.list_older_run_ids(db, workflow_id, keep)
                if old_ids:
                    RunRepository.delete_runs(db, old_ids)
        except Exception:  # noqa: BLE001
            log.exception(f"Failed to finalize run {run_id}")

    return _on_run_finished
