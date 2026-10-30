"""Structured extraction - LLM that returns JSON matching a schema."""

from __future__ import annotations

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.llm import LLMExecutor


class ExtractExecutor(LLMExecutor):
    node_type = "extract"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        # Same underlying LLM flow but forces JSON output and parses
        config["format"] = "json"
        result = await super()._run(ctx, config)
        if result.status != "success":
            return result
        try:
            import json

            if isinstance(result.output, str):
                result.output = json.loads(result.output)
        except Exception as exc:
            result.status = "failed"
            result.error = f"JSON parse failed: {exc}"
        return result
