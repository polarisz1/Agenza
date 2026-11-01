"""Base executor - shared resolve + error handling."""

from __future__ import annotations

from typing import Any

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.errors import describe_exception
from app.core.engine.variable import VariableError, resolve


class BaseExecutor:
    """Convenience base that resolves template strings before execute."""

    node_type: str = "base"

    async def execute(self, ctx: NodeContext) -> NodeResult:
        try:
            resolved = self._resolve_config(ctx)
            return await self._run(ctx, resolved)
        except VariableError as exc:
            return NodeResult(status="failed", error=f"Variable resolution error: {exc}")
        except Exception as exc:
            return NodeResult(status="failed", error=describe_exception(exc))

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        raise NotImplementedError

    def _resolve_config(self, ctx: NodeContext) -> dict:
        """Deep-resolve all string values in node config."""
        visible = ctx.available or ctx.upstream
        scope: dict[str, Any] = {"inputs": ctx.run_inputs, **visible}
        # 同时支持用节点名称引用上游输出：{{ 情感分类.output }}
        for nid, out in visible.items():
            name = ctx.node_names.get(nid)
            if name:
                scope[name] = out

        def _walk(value: Any) -> Any:
            if isinstance(value, str):
                if "{{" in value and "}}" in value:
                    return resolve(value, scope)
                return value
            if isinstance(value, dict):
                return {k: _walk(v) for k, v in value.items()}
            if isinstance(value, list):
                return [_walk(v) for v in value]
            return value

        config = dict(ctx.node.get("config", {}))
        return _walk(config)
