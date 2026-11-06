"""Run service - orchestrates engine + repository."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.engine.contexts import NodeResult
from app.core.engine.limits import clamp_serialized
from app.core.engine.manager import RunManager, get_run_manager
from app.core.engine.validators import BLOCKING_CODES, validate_graph
from app.core.exceptions import AppError
from app.core.logger import log
from app.core.tenancy import get_tenant
from app.core.time import utcnow
from app.db.database import SessionLocal
from app.modules.providers.service import build_registry
from app.modules.runs.models import NodeRun, Run, RunDeepAnalysis
from app.modules.runs.repository import RunRepository
from app.modules.runs.schemas import (
    CompareNode,
    NodeRunDetail,
    RunCompareResult,
    RunDetail,
    RunDiagnosisResponse,
    RunListItem,
    RunResponse,
)
from app.modules.settings.service import SettingsService
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
            raise AppError(404, "Workflow not found")
        return await RunService._start(session, wf, wf.graph.model_dump(), inputs, trigger)

    @staticmethod
    async def rerun(session: Session, run_id: str) -> RunResponse:
        """基于历史运行的图快照 + 输入重新发起一次运行。"""
        run = RunRepository.get(session, run_id)
        if not run:
            raise AppError(404, "Run not found")

        try:
            graph = json.loads(run.graph_snapshot)
            inputs = json.loads(run.inputs_json) if run.inputs_json else {}
        except Exception as exc:
            raise AppError(422, f"Invalid run snapshot: {exc}") from exc

        wf = WorkflowService.get(session, run.workflow_id)
        if not wf:
            raise AppError(404, "Workflow not found")

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
        run = RunService.prepare_run(session, wf, graph, inputs, trigger)
        # Celery 可用时 prepare_run 之外只投递；桌面模式同步执行（保持原有行为）
        if not RunService.dispatch_prepared_run(session, run, graph, inputs):
            await RunService.execute_prepared_run(session, run, graph, inputs)
        return _run_response(run)

    @staticmethod
    def prepare_run(
        session: Session,
        wf: Any,
        graph: dict,
        inputs: dict,
        trigger: str = "manual",
        *,
        version_id: str | None = None,
        version_seq: int | None = None,
    ) -> Run:
        """校验图与输入并落 Run 记录；供手动运行与外部触发共用。

        外部触发会显式传发布版本，避免运行详情把版本显示成最新草稿版本。
        """
        # 同一工作流默认串行：已有运行中则拒绝（TBD 多实例并发的默认策略）
        running = RunRepository.list(session, workflow_id=wf.id, status="running", limit=1)
        if running:
            raise AppError(409, "Workflow already has a running run")

        if not graph.get("nodes"):
            raise AppError(422, "Workflow is empty")

        check = validate_graph(nodes=graph.get("nodes", []), edges=graph.get("edges", []))
        if check["blocking"]:
            blocking = [i for i in check["issues"] if i["code"] in BLOCKING_CODES]
            issues = "; ".join(i["message"] for i in blocking)
            raise AppError(422, f"Invalid graph: {issues}")

        missing = [
            f["key"]
            for f in graph.get("inputs", [])
            if f.get("required") and f["key"] not in (inputs or {})
        ]
        if missing:
            raise AppError(400, f"Missing required inputs: {', '.join(missing)}")

        run_id = f"r_{uuid.uuid4().hex[:10]}"
        if version_id is None:
            latest = WorkflowService.latest_version(session, wf.id)
            if latest is not None:
                version_id, version_seq = latest[0], latest[1]
        # 提前取 workspace_id：RunRepository.create 会写入；回调里用同一值写 NodeRun
        from app.core.tenancy import get_workspace_id

        ws_id = str(get_workspace_id()) if get_workspace_id() else None
        tenant = get_tenant()
        triggered_by = str(tenant.user_id) if tenant is not None else None
        run = Run(
            id=run_id,
            workspace_id=ws_id,
            triggered_by=triggered_by,
            created_by=triggered_by,
            updated_by=triggered_by,
            workflow_id=wf.id,
            workflow_name=wf.name,
            graph_snapshot=json.dumps(graph, ensure_ascii=False),
            inputs_json=json.dumps(inputs or {}, ensure_ascii=False),
            status="running",
            trigger=trigger,
            started_at=utcnow(),
            version_id=version_id,
            version_seq=version_seq,
        )
        RunRepository.create(session, run)
        # 先把 run 落库：引擎回调走独立的 SessionLocal，看不到未提交的数据。
        # 部分唯一索引（0002）会在并发双击时抛 IntegrityError，这里翻成 409。
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise AppError(409, "Workflow already has a running run") from None
        return run

    @staticmethod
    def dispatch_prepared_run(session: Session, run: Run, graph: dict, inputs: dict) -> bool:
        """Celery 可用时投递任务并返回 True；否则返回 False 由调用方决定同步/后台执行。"""
        # 懒加载导入，避免 service ↔ tasks 循环依赖。
        from app.modules.runs.tasks import celery_app, execute_workflow_async

        if celery_app is None:
            return False
        execute_workflow_async(
            run.id,
            run.workflow_id,
            inputs or {},
            run.workspace_id,
            run.triggered_by,
        )
        return True

    @staticmethod
    async def execute_prepared_run(session: Session, run: Run, graph: dict, inputs: dict) -> None:
        """在进程内执行已落库的 Run（桌面模式 / 无 Celery 的后台任务）。"""
        providers_registry = build_registry(session)
        # 延迟导入：gateway.service 依赖 RunService，模块级导入会形成循环
        from app.modules.gateway.service import GatewayService

        gateway = GatewayService.build_runtime(session, providers_registry)
        manager: RunManager = get_run_manager()

        # 节点默认超时取设置页的 default_timeout（评审 S8：设置项要真的生效）
        default_timeout = SettingsService.get_effective(session, "default_timeout")

        await manager.start_run(
            run_id=run.id,
            graph=graph,
            inputs=inputs or {},
            providers_registry=providers_registry,
            gateway=gateway,
            default_timeout=float(default_timeout)
            if isinstance(default_timeout, int | float)
            else None,
            on_node_started=_make_node_started(run.id, run.workspace_id, run.triggered_by),
            on_node_finished=_make_node_finished(run.id, run.workspace_id, run.triggered_by),
            on_run_finished=_make_run_finished(run.id, run.workflow_id),
        )

    @staticmethod
    async def execute_run_in_background(
        run_id: str,
        workflow_id: str,
        graph: dict,
        inputs: dict,
        workspace_id: str,
        triggered_by: str,
    ) -> None:
        """FastAPI BackgroundTasks 入口：独立 Session + 租户上下文执行。"""
        from uuid import UUID

        from app.core.tenancy import TenantContext, clear_tenant, set_tenant

        set_tenant(
            TenantContext(
                workspace_id=UUID(workspace_id),
                user_id=UUID(triggered_by),
                user_email="",
                role="editor",
            )
        )
        try:
            with SessionLocal() as session:
                run = RunRepository.get(session, run_id)
                if run is None:
                    return
                await RunService.execute_prepared_run(session, run, graph, inputs)
        finally:
            clear_tenant()

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
                total_tokens=r.total_tokens or 0,
            )
            for r in runs
        ]

    @staticmethod
    def get(session: Session, run_id: str) -> RunDetail | None:
        run = RunRepository.get(session, run_id)
        if not run:
            return None
        nodes = RunRepository.list_node_runs(session, run_id)
        inputs: dict = {}
        if run.inputs_json:
            try:
                parsed = json.loads(run.inputs_json)
                if isinstance(parsed, dict):
                    inputs = parsed
            except Exception:
                inputs = {}
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
            inputs=inputs,
            version_id=run.version_id,
            version_seq=run.version_seq,
            nodes=[_to_node_detail(nr) for nr in nodes],
        )

    @staticmethod
    def compare(session: Session, a_id: str, b_id: str) -> RunCompareResult:
        """按 node_id 对齐两次运行的节点结果（F1）。

        只允许同一工作流的两次运行：跨工作流的节点 id 没有可比性，
        硬对齐会给出误导性的"差异"。
        """
        a = RunService.get(session, a_id)
        b = RunService.get(session, b_id)
        if a is None or b is None:
            raise AppError(404, "Run not found")
        if a.workflow_id != b.workflow_id:
            raise AppError(422, "只能对比同一工作流的两次运行")

        a_nodes = {node.node_id: node for node in a.nodes}
        b_nodes = {node.node_id: node for node in b.nodes}
        ordered = [node.node_id for node in a.nodes]
        ordered.extend(node_id for node_id in b_nodes if node_id not in a_nodes)

        return RunCompareResult(
            a=a,
            b=b,
            nodes=[
                CompareNode(
                    node_id=node_id,
                    node_name=(a_nodes.get(node_id) or b_nodes[node_id]).node_name,
                    node_type=(a_nodes.get(node_id) or b_nodes[node_id]).node_type,
                    a=a_nodes.get(node_id),
                    b=b_nodes.get(node_id),
                )
                for node_id in ordered
            ],
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
                except Exception:
                    continue
        return outputs

    @staticmethod
    def usage_by_model(session: Session, since: datetime) -> list[dict]:
        """按模型聚合 Token / 调用次数 / 成功率 / 延迟（GATE-01 预算与性能统计）。

        只统计真正调用过模型的节点（model 非空），供 gateway 模块做成本换算；
        跨模块查询走本 service，避免 gateway 直接依赖 runs.repository。
        """
        rows = (
            session.query(
                NodeRun.model,
                NodeRun.status,
                func.count(NodeRun.id),
                func.sum(NodeRun.tokens_in),
                func.sum(NodeRun.tokens_out),
                func.avg(NodeRun.duration_ms),
            )
            .filter(
                NodeRun.model.isnot(None),
                NodeRun.deleted_at.is_(None),
                NodeRun.started_at >= since,
            )
            .group_by(NodeRun.model, NodeRun.status)
            .all()
        )
        result = [
            {
                "model": model,
                "status": status,
                "calls": calls or 0,
                "tokens_in": int(tokens_in or 0),
                "tokens_out": int(tokens_out or 0),
                "avg_duration_ms": float(avg_duration or 0),
            }
            for model, status, calls, tokens_in, tokens_out, avg_duration in rows
        ]

        # GATE-04 Phase 2：AI 深度分析同样消耗 Token，计入预算口径
        deep_rows = (
            session.query(
                RunDeepAnalysis.model,
                func.count(RunDeepAnalysis.id),
                func.sum(RunDeepAnalysis.tokens_in),
                func.sum(RunDeepAnalysis.tokens_out),
            )
            .filter(
                RunDeepAnalysis.model.isnot(None),
                RunDeepAnalysis.deleted_at.is_(None),
                RunDeepAnalysis.created_at >= since,
            )
            .group_by(RunDeepAnalysis.model)
            .all()
        )
        result.extend(
            {
                "model": model,
                "status": "success",
                "calls": calls or 0,
                "tokens_in": int(tokens_in or 0),
                "tokens_out": int(tokens_out or 0),
                "avg_duration_ms": 0.0,
            }
            for model, calls, tokens_in, tokens_out in deep_rows
        )
        return result

    @staticmethod
    def diagnose(session: Session, run_id: str) -> RunDiagnosisResponse | None:
        """GATE-04：基于错误文本 + 节点配置做确定性根因分析（不调用模型）。"""
        from app.modules.runs.diagnosis import build_run_diagnosis

        run = RunRepository.get(session, run_id)
        if run is None:
            return None
        return build_run_diagnosis(run, RunRepository.list_node_runs(session, run_id))

    @staticmethod
    def count(session: Session) -> int:
        return RunRepository.count(session)

    @staticmethod
    def clear_all(session: Session) -> int:
        """清空全部运行记录（含节点级记录）。两张表的删除必须在同一事务里提交。"""
        deleted = RunRepository.clear_all(session)
        session.commit()
        return deleted

    @staticmethod
    async def cancel(run_id: str) -> bool:
        manager = get_run_manager()
        return await manager.cancel_run(run_id)


def _to_node_detail(nr: NodeRun) -> NodeRunDetail:
    output: Any = None
    if nr.output_json:
        try:
            output = json.loads(nr.output_json)
        except Exception:
            output = nr.output_json

    # 节点输入（F1/B3）：run_inputs + 直接上游输出，供"过程可见"回看
    input_data: Any = None
    if nr.input_json:
        try:
            input_data = json.loads(nr.input_json)
        except Exception:
            input_data = nr.input_json

    return NodeRunDetail(
        id=nr.id,
        node_id=nr.node_id,
        node_type=nr.node_type,
        node_name=nr.node_name,
        status=nr.status,
        attempt=nr.attempt or 1,
        started_at=nr.started_at,
        finished_at=nr.finished_at,
        input=input_data,
        output=output,
        error=nr.error,
        model=nr.model,
        tokens_in=nr.tokens_in or 0,
        tokens_out=nr.tokens_out or 0,
        duration_ms=nr.duration_ms or 0,
    )


def _run_response(run: Run) -> RunResponse:
    return RunResponse(
        id=run.id,
        workflow_id=run.workflow_id,
        workflow_name=run.workflow_name,
        status=run.status,
        trigger=run.trigger,
        started_at=run.started_at,
    )


# ---- Engine callbacks（每次独立 Session，避免复用已关闭的请求级 Session）----


def _make_node_started(run_id: str, workspace_id: str | None, triggered_by: str | None = None):
    async def _on_node_started(node_id: str, node: dict, node_input: dict | None = None) -> None:
        nr_id = f"nr_{uuid.uuid4().hex[:14]}"
        node_type = node.get("type") or "unknown"
        node_name = node.get("name") or node_id
        input_json = (
            clamp_serialized(json.dumps(node_input, ensure_ascii=False, default=str))
            if node_input
            else None
        )
        try:
            with SessionLocal() as db:
                db.add(
                    NodeRun(
                        id=nr_id,
                        workspace_id=workspace_id,
                        run_id=run_id,
                        node_id=node_id,
                        node_type=node_type,
                        node_name=node_name,
                        status="running",
                        attempt=1,
                        started_at=utcnow(),
                        duration_ms=0,
                        input_json=input_json,
                        created_by=triggered_by,
                        updated_by=triggered_by,
                    )
                )
                db.commit()
        except Exception:
            log.exception(f"Failed to persist node start {run_id}/{node_id}")

    return _on_node_started


def _make_node_finished(run_id: str, workspace_id: str | None, triggered_by: str | None = None):
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
                        workspace_id=workspace_id,
                        run_id=run_id,
                        node_id=node_id,
                        node_type=node.get("type") or "unknown",
                        node_name=node.get("name") or node_id,
                        status=result.status,
                        attempt=1,
                        started_at=utcnow(),
                        created_by=triggered_by,
                        updated_by=triggered_by,
                    )
                    db.add(nr)
                nr.status = result.status
                nr.finished_at = utcnow()
                nr.updated_by = triggered_by or nr.updated_by
                nr.duration_ms = duration_ms
                nr.tokens_in = result.tokens_in
                nr.tokens_out = result.tokens_out
                nr.model = result.model
                nr.error = result.error or (
                    "节点执行失败（未提供错误信息）" if result.status == "failed" else None
                )
                nr.output_json = (
                    clamp_serialized(json.dumps(result.output, ensure_ascii=False, default=str))
                    if result.output is not None
                    else None
                )
                db.commit()
        except Exception:
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
                    finished_at=utcnow(),
                    duration_ms=duration_ms,
                    total_tokens=total_tokens,
                )
                WorkflowService.mark_run(db, workflow_id)
                # 保留策略：优先用设置页的 retention_per_workflow（S8），
                # 没设置过就退回环境配置 RUN_RETENTION
                configured = SettingsService.get_effective(db, "retention_per_workflow")
                keep = max(
                    1,
                    configured if isinstance(configured, int) else settings.RUN_RETENTION,
                )
                old_ids = RunRepository.list_older_run_ids(db, workflow_id, keep)
                if old_ids:
                    RunRepository.delete_runs(db, old_ids)
                # 收尾 = 更新 run + 标记工作流最近运行 + 按保留策略删除旧记录，
                # 三件事必须一次性提交，否则中途失败会留下"运行结束但工作流没更新"的脏状态
                db.commit()
        except Exception:
            log.exception(f"Failed to finalize run {run_id}")

    return _on_run_finished
