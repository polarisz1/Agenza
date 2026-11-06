"""TRIGGER-01 Phase B：HTTP 触发服务。

外部调用方只拿到 202 + run_id，实际执行交给 Celery 或后台任务；
触发对象必须是**已发布版本**，保证外部自动化不受草稿编辑影响。
"""

from __future__ import annotations

import json

from fastapi import BackgroundTasks
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.modules.runs.models import Run
from app.modules.runs.repository import RunRepository
from app.modules.runs.service import RunService
from app.modules.triggers.repository import TriggerRequestRepository
from app.modules.triggers.schemas import TriggerRunResponse
from app.modules.workflows.repository import WorkflowRepository
from app.modules.workflows.service import WorkflowService

_MAX_IDEMPOTENCY_KEY = 200


def _response(run: Run, *, deduplicated: bool) -> TriggerRunResponse:
    return TriggerRunResponse(
        run_id=run.id,
        workflow_id=run.workflow_id,
        workflow_name=run.workflow_name,
        status=run.status,
        trigger=run.trigger,
        deduplicated=deduplicated,
    )


class TriggerService:
    @staticmethod
    def trigger_http(
        session: Session,
        *,
        workspace_id: str,
        user_id: str,
        workflow_id: str,
        inputs: dict,
        background: BackgroundTasks,
        idempotency_key: str | None = None,
    ) -> TriggerRunResponse:
        key = (idempotency_key or "").strip() or None
        if key is not None and len(key) > _MAX_IDEMPOTENCY_KEY:
            raise AppError(400, f"Idempotency-Key 不能超过 {_MAX_IDEMPOTENCY_KEY} 个字符")

        if key is not None:
            existing = TriggerRequestRepository.get(
                session, workflow_id=workflow_id, idempotency_key=key
            )
            if existing is not None:
                if not existing.run_id:
                    raise AppError(409, "相同 Idempotency-Key 的请求正在处理中")
                run = RunRepository.get(session, existing.run_id)
                if run is not None:
                    return _response(run, deduplicated=True)

        wf = WorkflowService.get(session, workflow_id)
        if wf is None:
            raise AppError(404, "Workflow not found")
        if not wf.published_version_id:
            raise AppError(409, "工作流尚未发布：请先在编辑器里发布后再触发")

        version = WorkflowRepository.get_version(session, workflow_id, wf.published_version_id)
        if version is None:
            raise AppError(409, "已发布版本不存在：请重新发布工作流")
        try:
            graph = json.loads(version.graph_json)
        except Exception as exc:
            raise AppError(409, f"发布版本图快照损坏：{exc}") from exc

        run = RunService.prepare_run(
            session,
            wf,
            graph,
            inputs or {},
            "api",
            version_id=version.id,
            version_seq=version.seq,
        )

        if key is not None:
            try:
                TriggerRequestRepository.create(
                    session,
                    workspace_id=workspace_id,
                    workflow_id=workflow_id,
                    idempotency_key=key,
                    run_id=run.id,
                )
                session.commit()
            except IntegrityError:
                # 极窄的并发窗口：另一个请求已写入同一幂等键，返回它对应的运行。
                session.rollback()
                existing = TriggerRequestRepository.get(
                    session, workflow_id=workflow_id, idempotency_key=key
                )
                if existing is not None and existing.run_id:
                    existing_run = RunRepository.get(session, existing.run_id)
                    if existing_run is not None:
                        return _response(existing_run, deduplicated=True)
                raise AppError(409, "重复的触发请求，请稍后重试") from None

        if not RunService.dispatch_prepared_run(session, run, graph, inputs or {}):
            background.add_task(
                RunService.execute_run_in_background,
                run.id,
                wf.id,
                graph,
                inputs or {},
                workspace_id,
                user_id,
            )
        return _response(run, deduplicated=False)
