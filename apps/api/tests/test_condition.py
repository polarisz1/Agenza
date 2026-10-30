"""条件执行器单测：比较符语义与错误契约。"""

from __future__ import annotations

import pytest

from app.core.engine.contexts import NodeContext
from app.core.engine.executors.condition import ConditionExecutor


def _ctx(**config) -> NodeContext:
    return NodeContext(
        node={"id": "c1", "type": "condition", "name": "判断", "config": config},
        run_inputs={},
    )


async def run_condition(**config):
    return await ConditionExecutor().execute(_ctx(**config))


async def test_eq_true() -> None:
    result = await run_condition(left="abc", op="eq", right="abc")

    assert result.status == "success"
    assert result.output["condition"] is True


async def test_eq_false() -> None:
    result = await run_condition(left="abc", op="eq", right="abd")

    assert result.status == "success"
    assert result.output["condition"] is False


async def test_neq() -> None:
    result = await run_condition(left=1, op="neq", right=2)

    assert result.output["condition"] is True


async def test_contains_string() -> None:
    result = await run_condition(left="hello world", op="contains", right="world")

    assert result.output["condition"] is True


async def test_is_empty() -> None:
    assert (await run_condition(left="", op="is_empty", right=None)).output["condition"] is True
    assert (await run_condition(left="x", op="is_empty", right=None)).output["condition"] is False


async def test_numeric_comparison() -> None:
    assert (await run_condition(left=10, op="gt", right=9)).output["condition"] is True
    assert (await run_condition(left=10, op="lt", right=9)).output["condition"] is False


async def test_unknown_operator_fails() -> None:
    result = await run_condition(left=1, op="bogus", right=1)

    assert result.status == "failed"
    assert "Unknown operator" in (result.error or "")


async def test_unresolvable_variable_fails_with_clear_error() -> None:
    ctx = NodeContext(
        node={"id": "c1", "type": "condition", "config": {"left": "{{ ghost.x }}", "op": "eq"}},
        run_inputs={},
        available={},
    )
    result = await ConditionExecutor().execute(ctx)

    assert result.status == "failed"
    assert "Variable resolution error" in (result.error or "")


@pytest.mark.xfail(
    strict=True,
    reason="G15：condition._coerce 是空实现，字符串数字与整数比较会抛 TypeError",
)
async def test_numeric_comparison_with_string_number() -> None:
    result = await run_condition(left="10", op="gt", right=9)

    assert result.status == "success"
    assert result.output["condition"] is True
