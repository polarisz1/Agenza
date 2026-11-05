"""Node execution contracts."""

from __future__ import annotations

from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field

NodeStatus = Literal["success", "failed", "skipped", "cancelled"]


class NodeResult(BaseModel):
    """Standard result returned by every executor."""

    status: NodeStatus
    output: Any = None
    error: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0


class NodeContext(BaseModel):
    """Per-execution context passed to each executor."""

    node: dict  # snapshot node definition
    run_inputs: dict  # workflow-level inputs
    upstream: dict[str, Any] = Field(default_factory=dict)  # node_id → output（直接上游）
    available: dict[str, Any] = Field(default_factory=dict)  # node_id → output（全部已完成祖先）
    node_names: dict[str, str] = Field(default_factory=dict)  # node_id → 节点名称
    providers: Any = None  # ProviderRegistry reference
    # GATE-01：AI Gateway 路由与预算快照（桌面未配置时为 None）
    model_router: Any = None  # core.providers.router.ModelRouter | None
    budget_exhausted: bool = False
    budget_message: str | None = None
    # 增量文本回调（F3 流式）：executor 调用它把 token 片段推给 SSE
    on_delta: Any = None


@runtime_checkable
class NodeExecutor(Protocol):
    async def execute(self, ctx: NodeContext) -> NodeResult: ...
