"""Kahn topological scheduler - runs DAG layer by layer."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from typing import Any

from app.core.engine.contexts import NodeContext, NodeExecutor, NodeResult
from app.core.engine.event_bus import get_event_bus
from app.core.engine.validators import kahn_layers
from app.core.logger import log

_DEFAULT_NODE_TIMEOUT = 120
_MAX_RETRY = 3


class Scheduler:
    """Executes nodes layer by layer, parallelizing within each layer."""

    def __init__(self, run_id: str, concurrency: int = 4) -> None:
        self.run_id = run_id
        self.semaphore = asyncio.Semaphore(concurrency)
        self.bus = get_event_bus()
        self._cancel_event = asyncio.Event()
        self._node_tasks: set[asyncio.Task] = set()

    @property
    def cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def request_cancel(self) -> None:
        """请求取消：停止调度新节点，并尽快终止正在执行的节点。"""
        self._cancel_event.set()
        for task in list(self._node_tasks):
            task.cancel()

    async def run(
        self,
        graph: dict,
        inputs: dict,
        registry: dict[str, NodeExecutor],
        providers_registry: Any,
        on_node_started=None,
        on_node_finished=None,
    ) -> dict[str, NodeResult]:
        """Execute the entire graph and return node_id → NodeResult map."""
        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])
        node_map = {n["id"]: n for n in nodes}

        # target → 上游节点集合
        parents: dict[str, set[str]] = defaultdict(set)
        for e in edges:
            parents[e["target"]].add(e["source"])

        layers = kahn_layers(nodes, edges)
        results: dict[str, NodeResult] = {}  # node_id → NodeResult
        node_names = {nid: (n.get("name") or nid) for nid, n in node_map.items()}

        for layer in layers:
            if self._cancel_event.is_set():
                # 已取消：本层及后续层全部标记为 cancelled，并补齐节点记录
                for nid in layer:
                    await self._finish(
                        node_id=nid,
                        node=node_map.get(nid, {}),
                        result=NodeResult(status="cancelled", error="Run cancelled"),
                        duration_ms=0,
                        results=results,
                        on_node_finished=on_node_finished,
                    )
                continue

            tasks = [
                asyncio.create_task(
                    self._run_one(
                        node_id=nid,
                        node_map=node_map,
                        node_names=node_names,
                        parents=parents,
                        results=results,
                        inputs=inputs,
                        registry=registry,
                        providers_registry=providers_registry,
                        on_node_started=on_node_started,
                        on_node_finished=on_node_finished,
                    ),
                    name=f"node:{self.run_id}:{nid}",
                )
                for nid in layer
            ]
            self._node_tasks.update(tasks)
            await asyncio.gather(*tasks, return_exceptions=True)
            self._node_tasks.difference_update(tasks)

        return results

    async def _run_one(
        self,
        node_id: str,
        node_map: dict[str, dict],
        node_names: dict[str, str],
        parents: dict[str, set[str]],
        results: dict[str, NodeResult],
        inputs: dict,
        registry: dict[str, NodeExecutor],
        providers_registry: Any,
        on_node_started,
        on_node_finished,
    ) -> None:
        node = node_map[node_id]
        node_type = node.get("type")
        config = node.get("config") or {}

        # 节点被禁用 → 直接跳过
        if config.get("enabled") is False:
            await self._finish(
                node_id,
                node,
                NodeResult(status="skipped", error="Node disabled"),
                0,
                results,
                on_node_finished,
            )
            return

        # Gather upstream inputs
        upstream: dict[str, Any] = {}
        for pid in parents.get(node_id, set()):
            prev = results.get(pid)
            if prev is None:
                # upstream not yet executed (shouldn't happen given layers)
                continue
            if prev.status == "success":
                upstream[pid] = prev.output
            elif prev.status in ("skipped", "cancelled"):
                # If any upstream is skipped/cancelled and this isn't a merge, skip
                if node_type != "merge":
                    await self._finish(
                        node_id,
                        node,
                        NodeResult(status="skipped", error=f"Upstream {pid} {prev.status}"),
                        0,
                        results,
                        on_node_finished,
                    )
                    return
            elif prev.status == "failed":
                await self._finish(
                    node_id,
                    node,
                    NodeResult(status="skipped", error=f"Upstream {pid} failed"),
                    0,
                    results,
                    on_node_finished,
                )
                return

        executor = registry.get(node_type)
        if executor is None:
            await self._finish(
                node_id,
                node,
                NodeResult(status="failed", error=f"No executor registered for type '{node_type}'"),
                0,
                results,
                on_node_finished,
            )
            return

        ctx = NodeContext(
            node=node,
            run_inputs=inputs,
            upstream=upstream,
            available=_collect_ancestor_outputs(node_id, parents, results),
            node_names=node_names,
            providers=providers_registry,
            emit=self.bus.publish,
        )

        if on_node_started:
            await _safe_call(on_node_started, node_id, node)

        await self.bus.publish(
            self.run_id,
            {
                "event": "node.started",
                "run_id": self.run_id,
                "node_id": node_id,
                "node_name": node.get("name") or node_id,
                "node_type": node_type,
            },
        )

        retry = _coerce_retry(config.get("retry"))
        timeout = _coerce_timeout(config)

        started = time.perf_counter()
        result = await self._execute_node(executor, ctx, retry, timeout)
        duration_ms = int((time.perf_counter() - started) * 1000)

        await self._finish(
            node_id,
            node,
            result,
            duration_ms,
            results,
            on_node_finished,
        )

    async def _execute_node(
        self,
        executor: NodeExecutor,
        ctx: NodeContext,
        retry: int,
        timeout: float | None,
    ) -> NodeResult:
        result = NodeResult(status="failed", error="Node did not run")

        try:
            async with self.semaphore:
                for attempt in range(1, retry + 2):
                    if self._cancel_event.is_set():
                        return NodeResult(status="cancelled", error="Run cancelled")

                    try:
                        result = await asyncio.wait_for(executor.execute(ctx), timeout=timeout)
                    except TimeoutError:
                        result = NodeResult(
                            status="failed", error=f"Node timed out after {timeout}s"
                        )
                    except asyncio.CancelledError:
                        return NodeResult(status="cancelled", error="Run cancelled")
                    except Exception as exc:
                        result = NodeResult(status="failed", error=str(exc))

                    if result.status != "failed" or attempt > retry:
                        break
                    if self._cancel_event.is_set():
                        return NodeResult(status="cancelled", error="Run cancelled")

                    # 重试间隔递增：1s → 2s → 4s
                    await asyncio.sleep(min(2 ** (attempt - 1), 4))
        except asyncio.CancelledError:
            return NodeResult(status="cancelled", error="Run cancelled")

        return result

    async def _finish(
        self,
        node_id: str,
        node: dict,
        result: NodeResult,
        duration_ms: int,
        results: dict[str, NodeResult],
        on_node_finished,
    ) -> None:
        results[node_id] = result

        await self.bus.publish(
            self.run_id,
            {
                "event": "node.finished",
                "run_id": self.run_id,
                "node_id": node_id,
                "node_name": node.get("name") or node_id,
                "node_type": node.get("type"),
                "status": result.status,
                "duration_ms": duration_ms,
                "tokens_in": result.tokens_in,
                "tokens_out": result.tokens_out,
                "model": result.model,
                "error": result.error,
            },
        )

        if on_node_finished:
            await _safe_call(on_node_finished, node_id, node, result, duration_ms)


def _collect_ancestor_outputs(
    node_id: str,
    parents: dict[str, set[str]],
    results: dict[str, NodeResult],
) -> dict[str, Any]:
    """收集所有已完成祖先节点的成功输出，供变量引用使用。"""
    collected: dict[str, Any] = {}
    seen: set[str] = set()
    stack = list(parents.get(node_id, ()))
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        prev = results.get(pid)
        if prev is not None and prev.status == "success":
            collected[pid] = prev.output
        stack.extend(parents.get(pid, ()))
    return collected


def _coerce_retry(value: Any) -> int:
    try:
        return max(0, min(int(value or 0), _MAX_RETRY))
    except (TypeError, ValueError):
        return 0


def _coerce_timeout(config: dict) -> float | None:
    raw = config.get("timeout_s", config.get("timeout", _DEFAULT_NODE_TIMEOUT))
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = float(_DEFAULT_NODE_TIMEOUT)
    return value if value > 0 else None


async def _safe_call(func, *args) -> None:
    """回调失败不能影响运行主流程。"""
    try:
        result = func(*args)
        if asyncio.iscoroutine(result):
            await result
    except Exception:
        log.exception("Engine callback failed")
