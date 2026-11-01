"""Output executor - surfaces final result."""

from __future__ import annotations

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor


class OutputExecutor(BaseExecutor):
    node_type = "output"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        """把上游结果暴露成最终输出。

        `source` 有三种写法（评审 G16：此前 `a or b if cond else None` 结合律错误，
        导致"配了 source 但没有上游"时静默变成 None，用户以为跑成功了）：
        1. 留空            → 取第一个上游节点的输出（保持旧行为）
        2. 上游节点 id      → 取该节点的**结构化**输出
        3. `{{ 节点.字段 }}` → 由 BaseExecutor 预先解析成字符串，原样作为结果

        注意 2 与 3 的差别：`_resolve_config` 在进入本方法前就把模板替换成了值，
        所以这里用**原始配置**是否含 `{{` 来区分"这是模板解析结果"还是"节点 id 写错了"。
        """
        field = config.get("field") or "result"
        raw_config = ctx.node.get("config", {}) or {}
        raw_source = str(raw_config.get("source") or "")
        source = str(config.get("source") or "").strip()

        if not source:
            if not ctx.upstream:
                return NodeResult(status="success", output={field: None})
            return NodeResult(status="success", output={field: next(iter(ctx.upstream.values()))})

        if source in ctx.upstream:
            return NodeResult(status="success", output={field: ctx.upstream[source]})

        if "{{" in raw_source:
            # 模板已被解析成字符串，直接作为最终值
            return NodeResult(status="success", output={field: source})

        # 显式写了来源（不是模板）却找不到对应节点：报错而不是静默 None
        available = "、".join(sorted(ctx.upstream)) or "（无上游）"
        return NodeResult(
            status="failed",
            error=f"输出节点的来源 '{source}' 不在上游节点里（可用：{available}）",
        )
