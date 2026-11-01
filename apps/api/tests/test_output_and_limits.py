"""输出截断（G8）与输出节点来源解析（G16）。"""

from __future__ import annotations

import json

import pytest

from app.core.engine.contexts import NodeContext
from app.core.engine.executors.output import OutputExecutor
from app.core.engine.limits import clamp_serialized, clamp_value


class _Ctx:
    """最小 NodeContext 替身：只需要 upstream / run_inputs。"""

    def __init__(self, upstream: dict | None = None, run_inputs: dict | None = None) -> None:
        self.upstream = upstream or {}
        self.run_inputs = run_inputs or {}


def _ctx(upstream: dict | None = None, run_inputs: dict | None = None) -> NodeContext:
    return NodeContext(
        node={"id": "out", "type": "output", "name": "输出", "config": {}},
        run_inputs=run_inputs or {},
        upstream=upstream or {},
    )


# ---------------- G8：截断 ----------------


def test_small_payload_is_untouched() -> None:
    payload = json.dumps({"ok": True}, ensure_ascii=False)

    assert clamp_serialized(payload) == payload


def test_large_payload_is_truncated_but_still_valid_json() -> None:
    payload = json.dumps({"blob": "中" * 400_000}, ensure_ascii=False)  # 约 1.2MB

    clamped = clamp_serialized(payload)

    parsed = json.loads(clamped)  # 关键：截断后仍可解析，读取端不会崩
    assert parsed["__truncated__"] is True
    assert parsed["original_bytes"] > 1024 * 1024
    assert len(parsed["preview"]) <= 2000


def test_clamp_value_marks_big_structures() -> None:
    value = {"items": ["x" * 100] * 20_000}

    clamped = clamp_value(value)

    assert isinstance(clamped, dict) and clamped["__truncated__"] is True


def test_exactly_at_limit_is_kept() -> None:
    payload = "a" * 1024

    assert clamp_serialized(payload, limit=1024) == payload


# ---------------- G16：output 节点的来源 ----------------


async def test_source_empty_takes_first_upstream() -> None:
    result = await OutputExecutor().execute(_ctx({"n1": {"a": 1}}))

    assert result.status == "success"
    assert result.output == {"result": {"a": 1}}


async def test_source_by_node_id() -> None:
    ctx = _ctx({"n1": {"a": 1}, "n2": {"b": 2}})

    result = await OutputExecutor().execute(
        NodeContext(
            node={"id": "out", "type": "output", "name": "输出", "config": {"source": "n2"}},
            run_inputs={},
            upstream=ctx.upstream,
        )
    )

    assert result.output == {"result": {"b": 2}}


async def test_source_without_upstream_does_not_silently_return_none() -> None:
    """G16 的核心：配了 source 但没有上游时，必须报错而不是静默 None。"""
    result = await OutputExecutor().execute(
        NodeContext(
            node={"id": "out", "type": "output", "name": "输出", "config": {"source": "n9"}},
            run_inputs={},
            upstream={},
        )
    )

    assert result.status == "failed"
    assert "n9" in (result.error or "")


async def test_source_unknown_id_reports_available_nodes() -> None:
    result = await OutputExecutor().execute(
        NodeContext(
            node={"id": "out", "type": "output", "name": "输出", "config": {"source": "n9"}},
            run_inputs={},
            upstream={"n1": {}, "n2": {}},
        )
    )

    assert result.status == "failed"
    assert "n1" in (result.error or "") and "n2" in (result.error or "")


async def test_source_supports_template_syntax() -> None:
    result = await OutputExecutor().execute(
        NodeContext(
            node={
                "id": "out",
                "type": "output",
                "name": "输出",
                "config": {"source": "{{ n1.name }}"},
            },
            run_inputs={},
            upstream={"n1": {"name": "小明"}},
        )
    )

    assert result.status == "success"
    assert result.output == {"result": "小明"}


async def test_source_template_with_unknown_source_fails_readably() -> None:
    result = await OutputExecutor().execute(
        NodeContext(
            node={
                "id": "out",
                "type": "output",
                "name": "输出",
                "config": {"source": "{{ missing.name }}"},
            },
            run_inputs={},
            upstream={"n1": {}},
        )
    )

    assert result.status == "failed"
    assert "Unknown variable source" in (result.error or "")


@pytest.mark.parametrize("field", ["result", "final", "answer"])
async def test_field_name_is_configurable(field: str) -> None:
    result = await OutputExecutor().execute(
        NodeContext(
            node={"id": "out", "type": "output", "name": "输出", "config": {"field": field}},
            run_inputs={},
            upstream={"n1": {"v": 1}},
        )
    )

    assert result.output == {field: {"v": 1}}
