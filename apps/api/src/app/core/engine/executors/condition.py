"""Condition executor - evaluates comparison, outputs boolean."""
from __future__ import annotations

from typing import Any

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor


_OPS = {
    "eq": lambda a, b: a == b,
    "neq": lambda a, b: a != b,
    "contains": lambda a, b: b in a if isinstance(a, (str, list, dict)) else False,
    "gt": lambda a, b: a > b,
    "lt": lambda a, b: a < b,
    "is_empty": lambda a, _: a is None or a == "" or a == [] or a == {},
}


def _coerce(val: Any) -> Any:
    """Try numeric coercion when both sides look like numbers."""
    return val


class ConditionExecutor(BaseExecutor):
    node_type = "condition"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        left = config.get("left")
        right = config.get("right")
        op_key = config.get("op", "eq")

        op = _OPS.get(op_key)
        if op is None:
            return NodeResult(status="failed", error=f"Unknown operator: {op_key}")

        try:
            result = op(left, right)
        except Exception as exc:
            return NodeResult(status="failed", error=f"Comparison error: {exc}")

        return NodeResult(status="success", output={"condition": bool(result), "true_branch": bool(result)})
