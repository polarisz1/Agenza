"""B2 回归：任何异常都不能变成"空错误"。

背景：Windows SelectorEventLoop 上的 `NotImplementedError` 消息为空，
`str(exc)` 让节点错误、运行汇总都变成空串，前端只能显示 `Run failed`。
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.errors import describe_exception
from app.core.engine.executors.base import BaseExecutor
from app.core.engine.manager import _summarize
from app.core.engine.scheduler import Scheduler


def _ctx() -> NodeContext:
    return NodeContext(
        node={"id": "n", "type": "boom", "name": "爆", "config": {}},
        run_inputs={},
    )


def test_describe_exception_keeps_business_message() -> None:
    assert describe_exception(ValueError("脚本缺少输出")) == "脚本缺少输出"


def test_describe_exception_falls_back_to_type_name() -> None:
    assert describe_exception(NotImplementedError()) == "NotImplementedError（无错误信息）"
    assert describe_exception(RuntimeError("  ")) == "RuntimeError（无错误信息）"


class _BlankBoom(BaseExecutor):
    node_type = "boom"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        raise NotImplementedError()  # 消息为空：典型的事故现场


def test_base_executor_never_returns_blank_error() -> None:
    result = asyncio.run(_BlankBoom().execute(_ctx()))

    assert result.status == "failed"
    assert result.error == "NotImplementedError（无错误信息）"


class _BlankCrash:
    async def execute(self, ctx: NodeContext) -> NodeResult:
        raise RuntimeError()


def test_scheduler_never_records_blank_error() -> None:
    scheduler = Scheduler(run_id="r_blank", concurrency=1)
    graph = {"nodes": [{"id": "n", "type": "boom", "name": "爆", "config": {}}], "edges": []}

    results = asyncio.run(
        scheduler.run(
            graph=graph,
            inputs={},
            registry={"boom": _BlankCrash()},
            providers_registry=None,
        )
    )

    assert results["n"].status == "failed"
    assert results["n"].error == "RuntimeError（无错误信息）"


def test_summary_never_degrades_to_generic_run_failed() -> None:
    status, error = _summarize(
        SimpleNamespace(cancelled=False),
        {"n1": NodeResult(status="failed"), "n2": NodeResult(status="failed")},
    )

    assert status == "failed"
    assert error == "2 个节点失败（未提供错误信息）"
