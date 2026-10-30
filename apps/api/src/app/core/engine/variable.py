"""Variable resolver: {{ source.field.path }} → actual value."""

from __future__ import annotations

import json
import re
from typing import Any

VAR_PATTERN = re.compile(r"\{\{\s*([^\s{}]+?)\s*\}\}")


class VariableError(ValueError):
    pass


def _resolve_path(data: Any, path: str) -> Any:
    """Walk dot.bracket.notation into a nested structure."""
    tokens = re.split(r"\.|\[|\]", path)
    tokens = [t for t in tokens if t]
    current = data
    for tok in tokens:
        if isinstance(current, dict):
            if tok in current:
                current = current[tok]
            else:
                raise VariableError(f"Missing key '{tok}' in object")
        elif isinstance(current, list):
            try:
                current = current[int(tok)]
            except (ValueError, IndexError) as exc:
                raise VariableError(f"Invalid array index '{tok}'") from exc
        else:
            raise VariableError(f"Cannot traverse into scalar {type(current).__name__}")
    return current


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# 变量由「源」+「路径」组成；源不能含点或方括号，之后的部分都交给 _resolve_path。
_SOURCE_PATTERN = re.compile(r"^([^.\[\]]+)(.*)$")


def resolve(template: str, scope: dict[str, Any]) -> str:
    """
    Replace all {{ ... }} references with resolved values.

    scope keys: "inputs" (workflow-level), node names / node IDs → output.

    支持 `{{ 节点.字段 }}`、`{{ 节点.list[0].字段 }}`，以及**根级下标** `{{ arr[0] }}`
    （PRD §5.4；此前 `a[0]` 会被误当成源名，评审 S14）。
    """

    def _replace(match: re.Match) -> str:
        raw = match.group(1).strip()
        parsed = _SOURCE_PATTERN.match(raw)
        if parsed is None:
            raise VariableError(f"Invalid variable reference: '{{{{ {raw} }}}}'")

        source_key, rest = parsed.group(1), parsed.group(2)
        path = rest.lstrip(".") if rest else ""

        # Workflow inputs take precedence
        data = (
            scope.get("inputs") if source_key in scope.get("inputs", {}) else scope.get(source_key)
        )
        if data is None:
            raise VariableError(f"Unknown variable source: '{source_key}'")

        if path:
            data = _resolve_path(data, path)
        return _stringify(data)

    return VAR_PATTERN.sub(_replace, template)
