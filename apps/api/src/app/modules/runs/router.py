"""Run FastAPI router + SSE endpoint."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.engine.event_bus import get_event_bus
from app.core.exceptions import AppError
from app.core.response import ERROR_RESPONSES, ApiResponse, CancelResult, success
from app.db.database import SessionLocal
from app.modules.runs.repository import RunRepository
from app.modules.runs.schemas import (
    NodeRunDetail,
    RunCompareResult,
    RunCreate,
    RunDetail,
    RunDiagnosisResponse,
    RunListData,
    RunResponse,
)
from app.modules.runs.service import RunService

router = APIRouter(responses=ERROR_RESPONSES)

_HEARTBEAT_SECONDS = 15
_TERMINAL_RUN_STATUS = ("success", "failed", "cancelled")


@router.get("", response_model=ApiResponse[RunListData])
def list_runs(
    workflow_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100),
    started_after: datetime | None = Query(default=None),
    started_before: datetime | None = Query(default=None),
    session: Session = Depends(get_session),
):
    items = RunService.list(
        session,
        workflow_id=workflow_id,
        status=status,
        limit=limit,
        started_after=started_after,
        started_before=started_before,
    )
    return success({"items": items})


@router.post(
    "",
    response_model=ApiResponse[RunResponse],
    deprecated=True,
    description=(
        "【已废弃，评审 G5 / D-2】发起运行请用 `POST /api/workflows/{wf_id}/runs`："
        "它与工作流资源同一条路径，工作流不存在时语义一致。"
        "此入口仅为兼容旧调用方保留，响应与行为完全等价。"
    ),
)
async def create_run(workflow_id: str, body: RunCreate, session: Session = Depends(get_session)):
    run = await RunService.start_run(session, workflow_id, body.inputs)
    return success(run)


@router.get("/compare", response_model=ApiResponse[RunCompareResult])
def compare_runs(
    ids: str = Query(..., description="两个运行 id，逗号分隔"),
    session: Session = Depends(get_session),
):
    """按 node_id 对齐两次运行，供前端并排对比（F1）。"""
    parts = [part.strip() for part in ids.split(",") if part.strip()]
    if len(parts) != 2:
        raise AppError(400, "ids 需要两个运行 id，用逗号分隔")
    return success(RunService.compare(session, parts[0], parts[1]))


@router.get("/{run_id}", response_model=ApiResponse[RunDetail])
def get_run(run_id: str, session: Session = Depends(get_session)):
    run = RunService.get(session, run_id)
    if not run:
        raise AppError(404, "Run not found")
    return success(run)


@router.get("/{run_id}/nodes/{node_id}", response_model=ApiResponse[NodeRunDetail])
def get_node_run(run_id: str, node_id: str, session: Session = Depends(get_session)):
    nr = RunService.get_node(session, run_id, node_id)
    if not nr:
        raise AppError(404, "Node run not found")
    return success(nr)


@router.get("/{run_id}/diagnosis", response_model=ApiResponse[RunDiagnosisResponse])
def diagnose_run(run_id: str, session: Session = Depends(get_session)):
    """GATE-04：确定性根因分析（不调用模型，失败节点 + 运行级兜底）。"""
    result = RunService.diagnose(session, run_id)
    if result is None:
        raise AppError(404, "Run not found")
    return success(result)


@router.post("/{run_id}/cancel", response_model=ApiResponse[CancelResult])
async def cancel_run(run_id: str, session: Session = Depends(get_session)):
    ok = await RunService.cancel(run_id)
    return success({"cancelled": ok})


@router.post("/{run_id}/rerun", response_model=ApiResponse[RunResponse])
async def rerun(run_id: str, session: Session = Depends(get_session)):
    """基于历史运行的图快照 + 输入重新发起运行。"""
    run = await RunService.rerun(session, run_id)
    return success(run)


@router.get("/{run_id}/events")
async def run_events(
    run_id: str,
    last_event_id: str | None = Query(default=None),
    last_event_id_header: str | None = Header(default=None, alias="Last-Event-ID"),
):
    """SSE - 实时推送 run 事件。

    - 先回放内存事件历史（按 Last-Event-ID 补齐）；
    - 内存里完全没有这次运行的历史（如后端重启）时，用已落库的 node_run 兜底回放，
      并给回放事件补上单调递增的 seq；
    - 之后持续订阅 EventBus 直到 run 结束。

    注意：这里**不**用 `Depends(get_session)`。请求级 Session 会一直被这条长连接占着，
    多个 SSE 客户端就能把连接池吃干。存在性检查用完即关。
    """
    with SessionLocal() as db:
        exists = RunRepository.get(db, run_id) is not None
    if not exists:
        raise AppError(404, "Run not found")

    raw_last = last_event_id or last_event_id_header
    try:
        parsed_last = int(raw_last) if raw_last else None
    except (TypeError, ValueError):
        parsed_last = None

    bus = get_event_bus()

    async def stream() -> AsyncIterator[str]:
        queue, backlog = await bus.subscribe(run_id, parsed_last)
        try:
            if backlog:
                for event in backlog:
                    yield _to_sse(event)
                if backlog[-1].get("event") == "run.finished":
                    return
            elif not bus.has_history(run_id):
                # 只有"本进程完全没有这次运行的历史"才走 DB 回放：
                # 否则（客户端只是追平了）直接用队列等新事件，避免重复/乱序。
                async for chunk, terminal in _replay_from_db(run_id, parsed_last or 0):
                    yield chunk
                    if terminal:
                        return

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                except TimeoutError:
                    yield ": heartbeat\n\n"
                    continue
                yield _to_sse(event)
                if event.get("event") == "run.finished":
                    return
        finally:
            bus.unsubscribe(run_id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _replay_from_db(run_id: str, base_seq: int = 0) -> AsyncIterator[tuple[str, bool]]:
    """内存无事件历史时，用已落库的 node_run / run 状态兜底回放。

    事件补上 `base_seq + i` 的序号，保证 SSE 的 `id:` 单调递增，
    客户端下次带 Last-Event-ID 重连时能正确对齐（评审 S6）。

    产出 (SSE 文本, 是否为终止事件)。
    """
    with SessionLocal() as db:
        run = RunRepository.get(db, run_id)
        nodes = RunRepository.list_node_runs(db, run_id)
        run_status = run.status if run else "failed"
        rows = [
            {
                "event": "node.finished",
                "run_id": run_id,
                "node_id": nr.node_id,
                "node_name": nr.node_name,
                "node_type": nr.node_type,
                "status": nr.status,
                "duration_ms": nr.duration_ms,
                "tokens_in": nr.tokens_in,
                "tokens_out": nr.tokens_out,
                "model": nr.model,
                "error": nr.error,
            }
            for nr in nodes
            if nr.status != "running"  # 未完成的节点不当作已结束回放
        ]

    seq = base_seq
    for row in rows:
        seq += 1
        yield _to_sse({**row, "seq": seq}), False

    if run_status in _TERMINAL_RUN_STATUS:
        seq += 1
        yield (
            _to_sse({"event": "run.finished", "run_id": run_id, "status": run_status, "seq": seq}),
            True,
        )


def _to_sse(event: dict) -> str:
    name = event.get("event", "message")
    seq = event.get("seq")
    payload = json.dumps(event, ensure_ascii=False, default=str)
    prefix = f"id: {seq}\n" if seq is not None else ""
    return f"{prefix}event: {name}\ndata: {payload}\n\n"
