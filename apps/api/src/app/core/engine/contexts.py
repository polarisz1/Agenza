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
    # TRIGGER-02：当前运行 ID 与已执行的工作流调用栈（用于嵌套/递归保护）
    run_id: str = ""
    workflow_stack: list[str] = Field(default_factory=list)
    # 子工作流加载器：workflow_id → {id, name, version_id, graph}；由 RunService 注入
    subworkflow_loader: Any = None
    # 子工作流运行器：workflow_id, inputs, parent_node_id → 子运行结果；由 RunService 注入
    subworkflow_runner: Any = None
    # TRIGGER-02 Phase B：嵌套节点的完整路径与父级落库/事件回调
    node_path: str = ""
    node_name_path: str = ""
    on_node_started: Any = None
    on_node_finished: Any = None


@runtime_checkable
class NodeExecutor(Protocol):
    async def execute(self, ctx: NodeContext) -> NodeResult: ...
