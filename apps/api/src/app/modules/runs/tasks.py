"""Celery 任务：工作流异步执行。

SaaS 模式下，API 进程只负责创建 Run 记录并投递任务到队列，
由 Celery worker 执行实际的工作流调度。
桌面模式（CELERY_BROKER_URL 为空）不使用此模块，RunService 走原同步 in-process 逻辑。
"""

from __future__ import annotations

import asyncio
import json
import logging

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.engine.manager import get_run_manager
from app.core.engine.scheduler import Scheduler
from app.db.database import SessionLocal
from app.modules.providers.service import build_registry
from app.modules.runs.service import (
    _make_node_finished,
    _make_node_started,
    _make_run_finished,
)
from app.modules.settings.service import SettingsService
from app.modules.workflows.service import WorkflowService

log = logging.getLogger(__name__)


if celery_app is not None:

    @celery_app.task(name="runs.execute_workflow", bind=True)
    def execute_workflow_task(
        self,
        run_id: str,
        workflow_id: str,
        inputs_json: str,
        workspace_id: str | None,
        triggered_by: str | None = None,
    ) -> None:
        """在 Celery worker 中执行工作流。

        workspace_id 由 API 进程显式传入：worker 进程没有请求级租户上下文。
        这里显式设置一次 TenantContext，保证 Provider / Gateway 查询也按租户隔离，
        并以 Run 的图快照执行（发布版本/重跑与创建时的图保持一致）。
        """
        from uuid import UUID

        from app.core.tenancy import TenantContext, clear_tenant, set_tenant
        from app.modules.runs.repository import RunRepository

        if workspace_id:
            set_tenant(
                TenantContext(
                    workspace_id=UUID(workspace_id),
                    user_id=UUID(triggered_by) if triggered_by else UUID(int=0),
                    user_email="",
                    role="editor",
                )
            )
        try:
            with SessionLocal() as session:
                run = RunRepository.get(session, run_id)
                wf = WorkflowService.get(session, workflow_id)
                if run is not None and run.graph_snapshot:
                    graph = json.loads(run.graph_snapshot)
                elif wf is not None:
                    graph = wf.graph.model_dump()
                else:
                    log.error(f"Run/Workflow not found for {run_id} / {workflow_id}")
                    return

                providers_registry = build_registry(session)
                default_timeout = SettingsService.get_effective(session, "default_timeout")

            inputs = json.loads(inputs_json) if inputs_json else {}

            manager = get_run_manager()
            scheduler = Scheduler(
                run_id=run_id,
                concurrency=settings.ENGINE_MAX_CONCURRENCY,
                default_timeout=float(default_timeout)
                if isinstance(default_timeout, int | float)
                else None,
            )

            on_node_started = _make_node_started(run_id, workspace_id, triggered_by)
            on_node_finished = _make_node_finished(run_id, workspace_id, triggered_by)
            on_run_finished = _make_run_finished(run_id, workflow_id)

            asyncio.run(
                manager._execute(
                    run_id=run_id,
                    graph=graph,
                    inputs=inputs,
                    providers_registry=providers_registry,
                    scheduler=scheduler,
                    on_node_started=on_node_started,
                    on_node_finished=on_node_finished,
                    on_run_finished=on_run_finished,
                )
            )
        except Exception:
            log.exception(f"Celery task execute_workflow failed for run {run_id}")
            raise
        finally:
            if workspace_id:
                clear_tenant()


def execute_workflow_async(
    run_id: str,
    workflow_id: str,
    inputs: dict,
    workspace_id: str | None,
    triggered_by: str | None = None,
) -> None:
    """发布异步执行任务到 Celery 队列。"""
    if celery_app is None:
        raise RuntimeError("Celery is not enabled (CELERY_BROKER_URL not set)")
    inputs_json = json.dumps(inputs or {}, ensure_ascii=False)
    execute_workflow_task.delay(run_id, workflow_id, inputs_json, workspace_id, triggered_by)
