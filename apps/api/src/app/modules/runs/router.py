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
from app.core.response import ApiResponse, CancelResult, success
from app.db.database import SessionLocal
from app.modules.runs.repository import RunRepository
from app.modules.runs.schemas import (
    NodeRunDetail,
    RunCreate,
    RunDetail,
    RunListData,
    RunResponse,
)
from app.modules.runs.service import RunService

router = APIRouter()

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


@router.post("", response_model=ApiResponse[RunResponse])
async def create_run(workflow_id: str, body: RunCreate, session: Session = Depends(get_session)):
    run = await RunService.start_run(session, workflow_id, body.inputs)
    return success(run)


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
    session: Session = Depends(get_session),
):
    """SSE - 实时推送 run 事件。

    - 连接时先回放内存事件历史（按 Last-Event-ID 补齐），
    - 内存无历史（如后端重启）时回放已落库的 node_run，
    - 之后持续订阅 EventBus 直到 run 结束。
    """
    run = RunRepository.get(session, run_id)
    if not run:
        raise AppError(404, "Run not found")

    raw_last = last_event_id or last_event_id_header
    try:
        parsed_last = int(raw_last) if raw_last else None
    except (TypeError, ValueError):
        parsed_last = None

    bus = get_event_bus()

    async def stream() -> AsyncIterator[str]:
        queue, backlog = bus.subscribe(run_id, parsed_last)
        try:
            if backlog:
                for event in backlog:
                    yield _to_sse(event)
                if backlog[-1].get("event") == "run.finished":
                    return
            else:
                async for chunk, terminal in _replay_from_db(run_id):
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


async def _replay_from_db(run_id: str) -> AsyncIterator[tuple[str, bool]]:
    """内存无事件历史时，用已落库的 node_run / run 状态兜底回放。

    产出 (SSE 文本, 是否为终止事件)。
    """
    with SessionLocal() as db:
        run = RunRepository.get(db, run_id)
        nodes = RunRepository.list_node_runs(db, run_id)
        run_status = run.status if run else "failed"

    for nr in nodes:
        if nr.status == "running":
            continue  # 未完成的节点不当作已结束回放
        yield (
            _to_sse(
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
            ),
            False,
        )

    if run_status in _TERMINAL_RUN_STATUS:
        yield _to_sse({"event": "run.finished", "run_id": run_id, "status": run_status}), True


def _to_sse(event: dict) -> str:
    name = event.get("event", "message")
    seq = event.get("seq")
    payload = json.dumps(event, ensure_ascii=False, default=str)
    prefix = f"id: {seq}\n" if seq is not None else ""
    return f"{prefix}event: {name}\ndata: {payload}\n\n"
