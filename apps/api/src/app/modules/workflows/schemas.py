"""Workflow Pydantic v2 schemas - OpenAPI 单一事实源。

节点配置在这里定义成**判别联合**（`type` 为判别键）：前端由 `@agentflow/contracts`
生成类型，不再手写图结构。新增节点类型时必须同时在此登记，否则图校验不通过。
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

WorkflowStatus = Literal["draft", "ready"]
NodeType = Literal["input", "llm", "extract", "http", "python", "condition", "merge", "output"]
PortKind = Literal["text", "number", "bool", "json"]

# 未知字段忽略：兼容历史图里已废弃的配置项，不让读取响应 500
_COMMON = ConfigDict(extra="ignore")


class NodeCommonConfig(BaseModel):
    """通用设置：每个节点都可能有，缺省不改变现有行为。"""

    model_config = _COMMON

    enabled: bool = True
    retry: int = 0
    timeout_s: float | None = None
    notes: str = ""


class InputConfig(NodeCommonConfig):
    key: str = ""
    data_type: PortKind = "text"
    required: bool = False
    default: Any = None
    description: str = ""


class LLMConfig(NodeCommonConfig):
    provider_id: str = ""
    model: str = ""
    system: str = ""
    prompt: str = ""
    temperature: float = 0.7
    max_tokens: int = 2048
    format: Literal["text", "json"] = "text"


class ExtractConfig(NodeCommonConfig):
    provider_id: str = ""
    model: str = ""
    prompt: str = ""
    fields_text: str = ""
    format: Literal["text", "json"] = "json"


class HttpConfig(NodeCommonConfig):
    method: str = "GET"
    url: str = ""
    headers: dict[str, Any] | None = None
    body: str | None = None


class PythonConfig(NodeCommonConfig):
    script: str = ""


class ConditionConfig(NodeCommonConfig):
    left: str = ""
    op: Literal["eq", "neq", "contains", "gt", "lt", "is_empty"] = "eq"
    right: str = ""


class MergeConfig(NodeCommonConfig):
    strategy: Literal["all", "any"] = "all"
    field: str = "merged"


class OutputConfig(NodeCommonConfig):
    field: str = "result"
    source: str = ""
    format: Literal["text", "json"] = "text"


class Position(BaseModel):
    model_config = _COMMON

    x: float = 0
    y: float = 0


class _BaseNode(BaseModel):
    """节点公共字段；`type` 由子类固定，作为判别联合的判别键。"""

    model_config = _COMMON

    id: str
    name: str
    position: Position = Field(default_factory=Position)


class InputNode(_BaseNode):
    type: Literal["input"] = "input"
    config: InputConfig = Field(default_factory=InputConfig)


class LLMNode(_BaseNode):
    type: Literal["llm"] = "llm"
    config: LLMConfig = Field(default_factory=LLMConfig)


class ExtractNode(_BaseNode):
    type: Literal["extract"] = "extract"
    config: ExtractConfig = Field(default_factory=ExtractConfig)


class HttpNode(_BaseNode):
    type: Literal["http"] = "http"
    config: HttpConfig = Field(default_factory=HttpConfig)


class PythonNode(_BaseNode):
    type: Literal["python"] = "python"
    config: PythonConfig = Field(default_factory=PythonConfig)


class ConditionNode(_BaseNode):
    type: Literal["condition"] = "condition"
    config: ConditionConfig = Field(default_factory=ConditionConfig)


class MergeNode(_BaseNode):
    type: Literal["merge"] = "merge"
    config: MergeConfig = Field(default_factory=MergeConfig)


class OutputNode(_BaseNode):
    type: Literal["output"] = "output"
    config: OutputConfig = Field(default_factory=OutputConfig)


NodeDef = Annotated[
    InputNode
    | LLMNode
    | ExtractNode
    | HttpNode
    | PythonNode
    | ConditionNode
    | MergeNode
    | OutputNode,
    Field(discriminator="type"),
]


class EdgeDef(BaseModel):
    """连线。`from_port` 区分条件节点的 true/false 分支（其余节点为 None）。"""

    model_config = _COMMON

    id: str
    source: str
    target: str
    from_port: Literal["true", "false"] | None = None


class WorkflowInputField(BaseModel):
    key: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    type: Literal["text", "number", "bool", "json"] = "text"
    required: bool = False
    default: Any = None


class GraphDef(BaseModel):
    version: int = 1
    inputs: list[WorkflowInputField] = Field(default_factory=list)
    nodes: list[NodeDef] = Field(default_factory=list)
    edges: list[EdgeDef] = Field(default_factory=list)


class WorkflowCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    graph: GraphDef
    viewport: dict | None = None


class WorkflowUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    graph: GraphDef | None = None
    viewport: dict | None = None
    status: WorkflowStatus | None = None


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: WorkflowStatus
    graph: GraphDef
    viewport: dict | None = None
    created_at: datetime
    updated_at: datetime
    last_run_at: datetime | None = None


class WorkflowListItem(BaseModel):
    id: str
    name: str
    description: str | None = None
    status: WorkflowStatus
    node_count: int
    last_run_at: datetime | None = None
    updated_at: datetime


class ValidateIssue(BaseModel):
    code: str
    node_id: str = ""
    message: str
    blocking: bool = False


class ValidateResult(BaseModel):
    ok: bool
    blocking: bool = False
    issues: list[ValidateIssue]


class WorkflowListData(BaseModel):
    items: list[WorkflowListItem]


class NodeTestRequest(BaseModel):
    """单节点调试入参：工作流输入 + 手动指定的上游输出。"""

    inputs: dict = Field(default_factory=dict)
    upstream: dict[str, Any] = Field(default_factory=dict)


class NodeTestResult(BaseModel):
    status: str
    output: Any = None
    error: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    duration_ms: int = 0


class DuplicateResult(BaseModel):
    id: str
    name: str


class WorkflowImportRequest(BaseModel):
    """导入工作流：payload 支持单个工作流对象或 {workflows: [...]} / 数组。"""

    payload: Any
    confirm: bool = False


class WorkflowImportItem(BaseModel):
    name: str
    target_name: str
    node_count: int
    conflict: bool


class WorkflowImportResult(BaseModel):
    items: list[WorkflowImportItem]
    created_ids: list[str]
