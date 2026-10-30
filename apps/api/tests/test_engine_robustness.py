"""引擎健壮性单测：

- 执行器内部抛异常：`_execute_node` 兜住 → 节点 failed，运行 failed（既有行为，固定住）
- 调度器外层抛异常（例如构建上下文的代码出错）：`_guarded` 兜住 → 节点 failed，
  不会从 results 里凭空消失（S11）
- 全部节点被跳过（禁用 / 分支未激活）应判 success，而不是 cancelled（S12）
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.engine import scheduler as scheduler_module
from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.manager import RunManager, _summarize
from app.core.engine.scheduler import Scheduler


class BoomExecutor:
    async def execute(self, ctx: NodeContext) -> NodeResult:
        raise RuntimeError(f"boom on {ctx.node['id']}")


def _single_node_graph(config: dict | None = None) -> dict:
    return {
        "nodes": [{"id": "n1", "type": "boom", "name": "坏节点", "config": config or {}}],
        "edges": [],
    }


async def test_executor_exception_yields_failed_node() -> None:
    scheduler = Scheduler(run_id="r_boom", concurrency=2)

    results = await scheduler.run(
        graph=_single_node_graph(),
        inputs={},
        registry={"boom": BoomExecutor()},
        providers_registry=None,
    )

    assert results["n1"].status == "failed"
    assert "boom on n1" in (results["n1"].error or "")


async def test_unexpected_scheduler_error_is_contained(monkeypatch) -> None:
    """模拟引擎外层代码出错：异常必须变成 failed 结果，而不是被 gather 吞掉。"""

    def _explode(*_args, **_kwargs):
        raise RuntimeError("scope lookup crashed")

    monkeypatch.setattr(scheduler_module, "_collect_ancestor_outputs", _explode)

    scheduler = Scheduler(run_id="r_crash", concurrency=2)
    recorded: dict = {}

    async def on_node_finished(node_id, node, result, duration_ms):
        recorded[node_id] = result.status

    results = await scheduler.run(
        graph=_single_node_graph(),
        inputs={},
        registry={"boom": BoomExecutor()},
        providers_registry=None,
        on_node_finished=on_node_finished,
    )

    assert "n1" in results, "节点不能从结果里消失"
    assert results["n1"].status == "failed"
    assert "节点执行异常" in (results["n1"].error or "")
    assert recorded == {"n1": "failed"}, "失败也要落库回调"


async def test_summarize_all_skipped_is_success_not_cancelled() -> None:
    results = {
        "a": NodeResult(status="skipped", error="Node disabled"),
        "b": NodeResult(status="skipped", error="分支未激活"),
    }

    assert _summarize(SimpleNamespace(cancelled=False), results) == ("success", None)


@pytest.mark.parametrize(
    ("cancelled", "results", "expected"),
    [
        (True, {}, ("cancelled", "Run cancelled")),
        (False, {"a": NodeResult(status="failed", error="连接超时")}, ("failed", "连接超时")),
        (False, {"a": NodeResult(status="cancelled")}, ("cancelled", "Run cancelled")),
        (False, {"a": NodeResult(status="success", output=1)}, ("success", None)),
    ],
)
def test_summarize_priority(cancelled, results, expected) -> None:
    assert _summarize(SimpleNamespace(cancelled=cancelled), results) == expected


class _FakeRegistry:
    """RunManager 内部持有 ExecutorRegistry，这里用同名接口替换。"""

    def __init__(self, mapping: dict) -> None:
        self._mapping = mapping

    def get(self, node_type: str):
        return self._mapping.get(node_type)

    def all(self) -> dict:
        return dict(self._mapping)


async def test_manager_reports_run_failed_when_node_crashes() -> None:
    manager = RunManager()
    manager._registry = _FakeRegistry({"boom": BoomExecutor()})  # type: ignore[attr-defined]

    seen: dict = {}

    async def on_run_finished(run_id, status, error, duration_ms, total_tokens):
        seen.update(status=status, error=error)

    async def on_node_finished(node_id, node, result, duration_ms):
        seen.setdefault("nodes", {})[node_id] = result.status

    task = await manager.start_run(
        run_id="r_mgr",
        graph=_single_node_graph(),
        inputs={},
        providers_registry=None,
        on_node_finished=on_node_finished,
        on_run_finished=on_run_finished,
    )
    await task

    assert seen["status"] == "failed"
    assert seen["nodes"] == {"n1": "failed"}
    assert seen["error"]
