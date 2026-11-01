"""RunManager - registry of in-flight runs, cancellation, concurrency gate."""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import settings
from app.core.engine.contexts import NodeResult
from app.core.engine.event_bus import get_event_bus
from app.core.engine.registry import build_default_registry
from app.core.engine.scheduler import Scheduler
from app.core.logger import log

# 节点完成回调：node_id, node, result, duration_ms
NodeFinishedHook = Callable[[str, dict, NodeResult, int], Awaitable[None]]
# 运行结束回调：run_id, status, error, duration_ms, total_tokens
RunFinishedHook = Callable[[str, str, str | None, int, int], Awaitable[None]]

_CANCEL_WAIT_SECONDS = 15


class RunManager:
    """Manages in-flight runs and their cancellation tasks."""

    def __init__(self) -> None:
        self._runs: dict[str, asyncio.Task] = {}
        self._schedulers: dict[str, Scheduler] = {}
        self._semaphore = asyncio.Semaphore(settings.ENGINE_MAX_CONCURRENCY)
        self._registry = build_default_registry()
        self._bus = get_event_bus()

    # ---- Public API ----

    async def start_run(
        self,
        *,
        run_id: str,
        graph: dict,
        inputs: dict,
        providers_registry: Any,
        default_timeout: float | None = None,
        on_node_started: Callable[[str, dict], Awaitable[None]] | None = None,
        on_node_finished: NodeFinishedHook | None = None,
        on_run_finished: RunFinishedHook | None = None,
    ) -> asyncio.Task:
        """Kick off a run as a background task and return it."""
        if self.is_running(run_id):
            raise RuntimeError(f"Run {run_id} already in progress")

        scheduler = Scheduler(
            run_id=run_id,
            concurrency=settings.ENGINE_MAX_CONCURRENCY,
            default_timeout=default_timeout,
        )
        task = asyncio.create_task(
            self._execute(
                run_id=run_id,
                graph=graph,
                inputs=inputs,
                providers_registry=providers_registry,
                scheduler=scheduler,
                on_node_started=on_node_started,
                on_node_finished=on_node_finished,
                on_run_finished=on_run_finished,
            ),
            name=f"run:{run_id}",
        )
        self._runs[run_id] = task
        self._schedulers[run_id] = scheduler
        return task

    async def cancel_run(self, run_id: str) -> bool:
        """Cancel a running run. Returns True if cancelled."""
        task = self._runs.get(run_id)
        if task is None or task.done():
            return False

        scheduler = self._schedulers.get(run_id)
        if scheduler is not None:
            # 先请求停止调度并终止在途节点，等待运行自身收尾（落库 + 发事件）
            scheduler.request_cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=_CANCEL_WAIT_SECONDS)
            except TimeoutError:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
            except Exception:
                log.exception(f"Run {run_id} raised while cancelling")
            return True

        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
        return True

    def is_running(self, run_id: str) -> bool:
        task = self._runs.get(run_id)
        return task is not None and not task.done()

    # ---- Internal ----

    async def _execute(
        self,
        *,
        run_id: str,
        graph: dict,
        inputs: dict,
        providers_registry: Any,
        scheduler: Scheduler,
        on_node_started,
        on_node_finished,
        on_run_finished,
    ) -> None:
        started = time.perf_counter()
        await self._bus.publish(run_id, {"event": "run.started", "run_id": run_id})

        final_status = "success"
        error: str | None = None
        results: dict[str, NodeResult] = {}

        try:
            results = await scheduler.run(
                graph=graph,
                inputs=inputs,
                registry=self._registry.all(),
                providers_registry=providers_registry,
                on_node_started=on_node_started,
                on_node_finished=on_node_finished,
            )
        except asyncio.CancelledError:
            final_status = "cancelled"
            error = "Run cancelled"
        except Exception as exc:
            final_status = "failed"
            error = str(exc)
            log.exception(f"Run {run_id} failed unexpectedly")
        else:
            final_status, error = _summarize(scheduler, results)

        duration_ms = int((time.perf_counter() - started) * 1000)
        total_tokens = sum(r.tokens_in + r.tokens_out for r in results.values())

        if on_run_finished:
            try:
                await on_run_finished(run_id, final_status, error, duration_ms, total_tokens)
            except Exception:
                log.exception(f"Run {run_id} finalize hook failed")

        await self._bus.publish(
            run_id,
            {
                "event": "run.finished",
                "run_id": run_id,
                "status": final_status,
                "error": error,
                "duration_ms": duration_ms,
                "total_tokens": total_tokens,
            },
        )

        self._runs.pop(run_id, None)
        self._schedulers.pop(run_id, None)


def _summarize(scheduler: Scheduler, results: dict[str, NodeResult]) -> tuple[str, str | None]:
    """根据节点结果汇总运行状态。

    - 取消优先：调度器被取消就是 cancelled
    - 有失败 → failed（取第一条错误）
    - 全部节点被跳过（禁用 / 分支未激活）→ success：没有失败，但也没有产出。
      这里**不能**判成 cancelled，否则"全部禁用"的工作流会显示"已取消"，误导用户。
    """
    if scheduler.cancelled:
        return "cancelled", "Run cancelled"

    failed = [r for r in results.values() if r.status == "failed"]
    if failed:
        detail = next((r.error for r in failed if r.error), "")
        if not detail:
            # 不能退回一句 "Run failed"：至少要说清"几个节点失败、没有错误信息"（B2）
            detail = f"{len(failed)} 个节点失败（未提供错误信息）"
        return "failed", detail

    if results and all(r.status == "cancelled" for r in results.values()):
        return "cancelled", "Run cancelled"

    return "success", None


# Singleton
_run_manager: RunManager | None = None


def get_run_manager() -> RunManager:
    global _run_manager
    if _run_manager is None:
        _run_manager = RunManager()
    return _run_manager
