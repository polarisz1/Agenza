"""Workflow Pydantic v2 schemas - OpenAPI single source of truth."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


WorkflowStatus = Literal["draft", "ready"]


class WorkflowInputField(BaseModel):
    key: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    type: Literal["text", "number", "bool", "json"] = "text"
    required: bool = False
    default: Any = None


class GraphDef(BaseModel):
    version: int = 1
    inputs: list[WorkflowInputField] = Field(default_factory=list)
    nodes: list[dict] = Field(default_factory=list)
    edges: list[dict] = Field(default_factory=list)


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
    graph: dict
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


class ValidateResult(BaseModel):
    ok: bool
    issues: list[dict]


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
