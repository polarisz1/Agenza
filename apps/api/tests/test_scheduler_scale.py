"""100 节点规模基线（评审 B1：M2 遗留，从未压测）。

只压调度器本身，不压模型：99 个节点在同一层并行，验证
1. 图规模上来后仍能全部产出结果（不漏节点）
2. 拓扑分层与并发闸门不会退化成串行
3. 给一个宽松的时间上限作为回归闸门（本地 <1s，CI 也远低于 5s）
"""

from __future__ import annotations

import asyncio
import time

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.input import InputExecutor
from app.core.engine.scheduler import Scheduler

NODE_COUNT = 100
TIME_BUDGET_SECONDS = 5.0


class CountingExecutor:
    def __init__(self) -> None:
        self.calls = 0

    async def execute(self, ctx: NodeContext) -> NodeResult:
        self.calls += 1
        return NodeResult(status="success", output={"node": ctx.node["id"]})


def _graph() -> tuple[dict, int]:
    nodes = [
        {"id": "in", "type": "input", "name": "输入1", "config": {"key": "text"}},
    ]
    edges = []
    for index in range(1, NODE_COUNT):
        nodes.append({"id": f"out_{index}", "type": "echo", "name": f"输出{index}", "config": {}})
        edges.append({"id": f"e_{index}", "source": "in", "target": f"out_{index}"})
    return {"nodes": nodes, "edges": edges}, NODE_COUNT - 1


def test_hundred_node_graph_completes_within_budget() -> None:
    graph, fanout = _graph()
    counter = CountingExecutor()
    registry = {"input": InputExecutor(), "echo": counter}

    async def run() -> dict[str, NodeResult]:
        scheduler = Scheduler(run_id="r_perf", concurrency=4)
        return await scheduler.run(
            graph=graph, inputs={"text": "hello"}, registry=registry, providers_registry=None
        )

    started = time.perf_counter()
    results = asyncio.run(run())
    elapsed = time.perf_counter() - started

    assert len(results) == NODE_COUNT
    assert counter.calls == fanout
    assert all(result.status == "success" for result in results.values())
    assert elapsed < TIME_BUDGET_SECONDS, f"100 节点调度耗时 {elapsed:.2f}s，超过预算"
