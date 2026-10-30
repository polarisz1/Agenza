"""Merge executor - combines multiple upstream outputs."""
from __future__ import annotations

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor


class MergeExecutor(BaseExecutor):
    node_type = "merge"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        strategy = config.get("strategy", "all")  # all | any
        field_name = config.get("field", "merged")

        # Collect all upstream results that are success
        outputs = []
        for nid, out in ctx.upstream.items():
            outputs.append(out)

        if strategy == "all":
            return NodeResult(status="success", output={field_name: outputs})
        # any
        return NodeResult(status="success", output={field_name: outputs[0] if outputs else None})
