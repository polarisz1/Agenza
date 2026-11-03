"""F3 引擎流式事件：ctx.on_delta → SSE `node.delta`，不改变最终结果。"""

from __future__ import annotations

import asyncio

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.event_bus import get_event_bus
from app.core.engine.executors.llm import LLMExecutor
from app.core.engine.scheduler import Scheduler
from app.core.providers.base import ChatResult, ProviderRegistry


class DeltaExecutor:
    async def execute(self, ctx: NodeContext) -> NodeResult:
        await ctx.on_delta("你")
        await ctx.on_delta("好")
        return NodeResult(status="success", output="你好")


def _graph() -> dict:
    return {"nodes": [{"id": "n", "type": "llm", "name": "LLM1", "config": {}}], "edges": []}


def test_scheduler_publishes_node_delta_events() -> None:
    bus = get_event_bus()

    async def _run() -> tuple[dict, list]:
        queue, _ = await bus.subscribe("run_stream_test")
        scheduler = Scheduler(run_id="run_stream_test", concurrency=1)
        results = await scheduler.run(
            graph=_graph(),
            inputs={},
            registry={"llm": DeltaExecutor()},
            providers_registry=None,
        )
        events = []
        while not queue.empty():
            events.append(queue.get_nowait())
        bus.unsubscribe("run_stream_test", queue)
        return results, events

    results, events = asyncio.run(_run())

    deltas = [event for event in events if event.get("event") == "node.delta"]
    assert [event["text"] for event in deltas] == ["你", "好"]
    assert all(event["node_id"] == "n" for event in deltas)
    # 最终结果仍来自 executor，与增量无关
    assert results["n"].output == "你好"
    assert any(event.get("event") == "node.finished" for event in events)


class FakeStreamingProvider:
    def __init__(self) -> None:
        self.seen: list[str] = []

    async def stream(self, *, on_delta=None, **kwargs) -> ChatResult:
        for piece in ("H", "i"):
            self.seen.append(piece)
            if on_delta:
                await on_delta(piece)
        return ChatResult(content="Hi", model="fake-model", tokens_in=1, tokens_out=2)

    async def chat(self, **kwargs) -> ChatResult:  # pragma: no cover - 不应被调用
        raise AssertionError("有 on_delta 时应走 stream")


def test_llm_executor_uses_stream_when_delta_callback_present() -> None:
    provider = FakeStreamingProvider()
    registry = ProviderRegistry()
    registry.register("pv_fake", provider)
    received: list[str] = []

    async def on_delta(text: str) -> None:
        received.append(text)

    ctx = NodeContext(
        node={
            "id": "n",
            "type": "llm",
            "name": "LLM1",
            "config": {"provider_id": "pv_fake", "model": "fake-model", "prompt": "hi"},
        },
        run_inputs={},
        upstream={},
        available={},
        node_names={},
        providers=registry,
        on_delta=on_delta,
    )

    result = asyncio.run(LLMExecutor().execute(ctx))

    assert received == ["H", "i"]
    assert result.status == "success"
    assert result.output == "Hi"
    assert result.model == "fake-model"
    assert (result.tokens_in, result.tokens_out) == (1, 2)


class ChatOnlyProvider:
    async def chat(self, **kwargs) -> ChatResult:
        return ChatResult(content="plain", model="m")


def test_llm_executor_falls_back_when_provider_has_no_stream() -> None:
    registry = ProviderRegistry()
    registry.register("pv_chat", ChatOnlyProvider())
    ctx = NodeContext(
        node={
            "id": "n",
            "type": "llm",
            "name": "LLM1",
            "config": {"provider_id": "pv_chat", "prompt": "hi"},
        },
        run_inputs={},
        providers=registry,
        on_delta=lambda text: None,
    )

    result = asyncio.run(LLMExecutor().execute(ctx))

    assert result.status == "success"
    assert result.output == "plain"
