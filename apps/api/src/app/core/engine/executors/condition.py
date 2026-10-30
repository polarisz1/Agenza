"""Condition executor - evaluates comparison, outputs boolean."""

from __future__ import annotations

import re
from typing import Any

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor

_OPS = {
    "eq": lambda a, b: _coerce(a) == _coerce(b),
    "neq": lambda a, b: _coerce(a) != _coerce(b),
    # 包含关系必须按原样比较："2" in "123" 不能被数值化破坏
    "contains": lambda a, b: b in a if isinstance(a, (str, list, dict)) else False,
    "gt": lambda a, b: _coerce(a) > _coerce(b),
    "lt": lambda a, b: _coerce(a) < _coerce(b),
    "is_empty": lambda a, _: a is None or a == "" or a == [] or a == {},
}

_NUMBER = re.compile(r"^[+-]?(\d+(\.\d*)?|\.\d+)$")


def _coerce(value: Any) -> Any:
    """把"看起来是数字"的字符串转成数字。

    变量插值出来的一律是字符串，所以 `"10" > 9` 会直接 TypeError；
    比较前统一转一下，`"10" > 9`、`"1.50" eq "1.5"` 都能按预期工作（G15）。
    非数字字符串保持原样。
    """
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or not _NUMBER.match(text):
        return value
    try:
        return int(text) if re.fullmatch(r"[+-]?\d+", text) else float(text)
    except ValueError:  # pragma: no cover - 正则已挡住
        return value


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

        return NodeResult(
            status="success", output={"condition": bool(result), "true_branch": bool(result)}
        )
