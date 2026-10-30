"""Output executor - surfaces final result."""
from __future__ import annotations

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor


class OutputExecutor(BaseExecutor):
    node_type = "output"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        # Output = reference to the primary upstream
        primary = config.get("source") or list(ctx.upstream.values())[0] if ctx.upstream else None
        field = config.get("field") or "result"
        return NodeResult(status="success", output={field: primary})
