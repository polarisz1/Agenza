"""Input executor - emits the configured input value."""
from __future__ import annotations

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor


class InputExecutor(BaseExecutor):
    node_type = "input"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        # config.key 优先（编辑器写入的字段名），回退到节点名称
        key = config.get("key") or ctx.node.get("name") or ""
        value = ctx.run_inputs.get(key, config.get("default"))
        return NodeResult(status="success", output={key: value})
