"""调度器分支语义单测：条件节点的 true/false 端口只激活对应分支。

用一个假执行器代替真实节点，验证四件事：
1. 条件为真 → true 支执行、false 支 skipped（带原因）
2. 条件为假 → 反向
3. merge 只收激活分支，输出顺序按边声明顺序（不再受 set 迭代顺序影响）
4. 没有 from_port 的普通边保持旧行为
"""

from __future__ import annotations

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.condition import ConditionExecutor
from app.core.engine.executors.merge import MergeExecutor
from app.core.engine.scheduler import Scheduler


class FakeExecutor:
    """记录执行次数并回显标识的输出节点。"""

    def __init__(self, tag: str) -> None:
        self.tag = tag
        self.calls = 0

    async def execute(self, ctx: NodeContext) -> NodeResult:
        self.calls += 1
        return NodeResult(status="success", output={"tag": self.tag, "node": ctx.node["id"]})


def _graph(edges: list[dict], condition: dict | None = None) -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "name": "输入", "config": {"key": "a"}},
            {
                "id": "c",
                "type": "condition",
                "name": "判断",
                "config": condition or {"left": "x", "op": "eq", "right": "x"},
            },
            {"id": "t", "type": "py", "name": "真支", "config": {}},
            {"id": "f", "type": "py", "name": "假支", "config": {}},
            {"id": "m", "type": "merge", "name": "合并", "config": {"strategy": "all"}},
        ],
        "edges": edges,
    }


async def _run(graph: dict, registry: dict) -> dict[str, NodeResult]:
    scheduler = Scheduler(run_id="r_test", concurrency=4)
    return await scheduler.run(
        graph=graph, inputs={"a": 1}, registry=registry, providers_registry=None
    )


def _registry(*tags: str) -> dict:
    return {
        "input": FakeExecutor("input"),
        "condition": ConditionExecutor(),
        "merge": MergeExecutor(),
        **{tag: FakeExecutor(tag) for tag in tags},
    }


async def test_true_branch_runs_and_false_branch_is_skipped() -> None:
    graph = _graph(
        [
            {"id": "e1", "source": "in", "target": "c"},
            {"id": "e2", "source": "c", "target": "t", "from_port": "true"},
            {"id": "e3", "source": "c", "target": "f", "from_port": "false"},
        ]
    )
    results = await _run(graph, _registry("py"))

    assert results["c"].status == "success"
    assert results["t"].status == "success"
    assert results["f"].status == "skipped"
    assert "分支未激活" in (results["f"].error or "")


async def test_false_branch_runs_when_condition_is_false() -> None:
    graph = _graph(
        [
            {"id": "e1", "source": "in", "target": "c"},
            {"id": "e2", "source": "c", "target": "t", "from_port": "true"},
            {"id": "e3", "source": "c", "target": "f", "from_port": "false"},
        ],
        condition={"left": "x", "op": "eq", "right": "y"},
    )
    results = await _run(graph, _registry("py"))

    assert results["t"].status == "skipped"
    assert results["f"].status == "success"


async def test_merge_collects_only_active_branch_in_edge_order() -> None:
    graph = _graph(
        [
            {"id": "e1", "source": "in", "target": "c"},
            {"id": "e2", "source": "c", "target": "t", "from_port": "true"},
            {"id": "e3", "source": "c", "target": "f", "from_port": "false"},
            {"id": "e4", "source": "t", "target": "m"},
            {"id": "e5", "source": "f", "target": "m"},
        ]
    )
    results = await _run(graph, _registry("py"))

    merged = results["m"].output["merged"]
    assert [item["node"] for item in merged] == ["t"], "未激活分支不应进入 merge"
    assert results["m"].status == "success"


async def test_plain_edge_from_condition_stays_active() -> None:
    """旧图里条件节点可能没有 from_port，此时按普通边处理。"""
    graph = _graph(
        [
            {"id": "e1", "source": "in", "target": "c"},
            {"id": "e2", "source": "c", "target": "t"},
        ],
        condition={"left": "x", "op": "eq", "right": "y"},
    )
    results = await _run(graph, _registry("py"))

    assert results["t"].status == "success"


async def test_disabled_node_skips_downstream() -> None:
    graph = _graph(
        [
            {"id": "e1", "source": "in", "target": "c"},
            {"id": "e2", "source": "c", "target": "t"},
        ]
    )
    graph["nodes"][2]["config"] = {"enabled": False}
    results = await _run(graph, _registry("py"))

    assert results["t"].status == "skipped"
    assert results["t"].error == "Node disabled"
