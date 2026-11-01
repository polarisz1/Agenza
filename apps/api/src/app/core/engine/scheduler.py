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

    def __init__(
        self,
        run_id: str,
        concurrency: int = 4,
        default_timeout: float | None = None,
    ) -> None:
        self.run_id = run_id
        self.semaphore = asyncio.Semaphore(concurrency)
        self.bus = get_event_bus()
        self._cancel_event = asyncio.Event()
        self._node_tasks: set[asyncio.Task] = set()
        # 节点没配 timeout_s 时用这个值（来自设置页的 default_timeout）
        self.default_timeout = default_timeout or _DEFAULT_NODE_TIMEOUT

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

        # target → [(source, from_port)]：保留边声明顺序（保证 merge 输入顺序确定）
        parent_edges: dict[str, list[tuple[str, str | None]]] = defaultdict(list)
        for e in edges:
            source, target = e.get("source"), e.get("target")
            if source in node_map and target in node_map:
                parent_edges[target].append((source, e.get("from_port")))

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
                    self._guarded(
                        node_id=nid,
                        node=node_map.get(nid, {}),
                        inner=self._run_one(
                            node_id=nid,
                            node_map=node_map,
                            node_names=node_names,
                            parent_edges=parent_edges,
                            results=results,
                            inputs=inputs,
                            registry=registry,
                            providers_registry=providers_registry,
                            on_node_started=on_node_started,
                            on_node_finished=on_node_finished,
                        ),
                        results=results,
                        on_node_finished=on_node_finished,
                    ),
                    name=f"node:{self.run_id}:{nid}",
                )
                for nid in layer
            ]
            self._node_tasks.update(tasks)
            await asyncio.gather(*tasks, return_exceptions=True)
            self._node_tasks.difference_update(tasks)

            # 兜底：`_run_one` 若没留下结果（极端情况），补一条 failed，
            # 否则该节点会从记录里凭空消失、而运行仍可能被判为成功。
            if not self._cancel_event.is_set():
                for nid in layer:
                    if nid not in results:
                        await self._finish(
                            node_id=nid,
                            node=node_map.get(nid, {}),
                            result=NodeResult(status="failed", error="节点未产生结果"),
                            duration_ms=0,
                            results=results,
                            on_node_finished=on_node_finished,
                        )

        return results

    async def _guarded(
        self,
        *,
        node_id: str,
        node: dict,
        inner,
        results: dict[str, NodeResult],
        on_node_finished,
    ) -> None:
        """执行节点并把意外异常记成节点失败，避免被 gather 静默吞掉。"""
        try:
            await inner
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.exception(f"Node {node_id} crashed")
            if node_id not in results:
                await self._finish(
                    node_id=node_id,
                    node=node,
                    result=NodeResult(status="failed", error=f"节点执行异常：{exc}"),
                    duration_ms=0,
                    results=results,
                    on_node_finished=on_node_finished,
                )

    async def _run_one(
        self,
        node_id: str,
        node_map: dict[str, dict],
        node_names: dict[str, str],
        parent_edges: dict[str, list[tuple[str, str | None]]],
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
        # 分支语义：来自条件节点的边只有与条件结果一致时才激活。
        # 未激活的边既不提供输入，也不算"上游失败"。
        upstream: dict[str, Any] = {}
        active_parents: list[str] = []
        inactive_parents: list[str] = []
        for pid, from_port in parent_edges.get(node_id, ()):
            prev = results.get(pid)
            if prev is None:
                # upstream not yet executed (shouldn't happen given layers)
                continue
            if not _branch_active(from_port, prev):
                inactive_parents.append(pid)
                continue
            active_parents.append(pid)
            if prev.status == "success":
                upstream[pid] = prev.output
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
            elif node_type != "merge":
                # 上游被跳过/取消：非 merge 节点不执行
                await self._finish(
                    node_id,
                    node,
                    NodeResult(status="skipped", error=f"Upstream {pid} {prev.status}"),
                    0,
                    results,
                    on_node_finished,
                )
                return

        if inactive_parents and not active_parents:
            await self._finish(
                node_id,
                node,
                NodeResult(
                    status="skipped",
                    error=f"分支未激活：{'、'.join(inactive_parents)} 未走该分支",
                ),
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
            available=_collect_ancestor_outputs(node_id, parent_edges, results),
            node_names=node_names,
            providers=providers_registry,
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
        timeout = _coerce_timeout(config, self.default_timeout)

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


def _branch_active(from_port: str | None, prev: NodeResult) -> bool:
    """判断来自条件节点的边是否激活。

    - 边没标 `from_port` → 视为普通边，恒激活（兼容旧图）
    - 上游输出没有布尔 `condition`（非条件节点）→ 恒激活
    - 否则：`true` 端口在条件为真时激活，`false` 端口反之
    """
    if from_port is None:
        return True

    output = prev.output
    if not isinstance(output, dict) or "condition" not in output:
        return True

    value = output.get("condition")
    if not isinstance(value, bool):
        return True

    return value == (from_port == "true")


def _collect_ancestor_outputs(
    node_id: str,
    parent_edges: dict[str, list[tuple[str, str | None]]],
    results: dict[str, NodeResult],
) -> dict[str, Any]:
    """收集所有已完成祖先节点的成功输出，供变量引用使用。"""
    collected: dict[str, Any] = {}
    seen: set[str] = set()
    stack = [src for src, _ in parent_edges.get(node_id, ())]
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        prev = results.get(pid)
        if prev is not None and prev.status == "success":
            collected[pid] = prev.output
        stack.extend(src for src, _ in parent_edges.get(pid, ()))
    return collected


def _coerce_retry(value: Any) -> int:
    try:
        return max(0, min(int(value or 0), _MAX_RETRY))
    except (TypeError, ValueError):
        return 0


def _coerce_timeout(config: dict, default: float = _DEFAULT_NODE_TIMEOUT) -> float | None:
    """节点级 timeout_s 优先；没配就用设置里的 default_timeout（<=0 表示不限制）。"""
    raw = config.get("timeout_s", config.get("timeout", default))
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = float(default)
    return value if value > 0 else None


async def _safe_call(func, *args) -> None:
    """回调失败不能影响运行主流程。"""
    try:
        result = func(*args)
        if asyncio.iscoroutine(result):
            await result
    except Exception:
        log.exception("Engine callback failed")
