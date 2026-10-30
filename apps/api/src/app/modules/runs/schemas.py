"""Run Pydantic schemas."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

RunStatus = Literal["waiting_input", "running", "success", "failed", "cancelled"]


class NodeRunSnapshot(BaseModel):
    node_id: str
    status: str
    output: Any = None
    error: str | None = None
    duration_ms: int = 0


class RunResponse(BaseModel):
    id: str
    workflow_id: str
    workflow_name: str
    status: RunStatus
    trigger: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    total_tokens: int = 0
    error: str | None = None


class RunListItem(BaseModel):
    id: str
    workflow_id: str
    workflow_name: str
    status: RunStatus
    trigger: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None


class RunCreate(BaseModel):
    inputs: dict = {}


class RunListData(BaseModel):
    items: list[RunListItem]


class NodeRunDetail(BaseModel):
    id: str
    node_id: str
    node_type: str
    node_name: str
    status: str
    attempt: int
    started_at: datetime | None = None
    finished_at: datetime | None = None
    input: Any = None
    output: Any = None
    error: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    duration_ms: int = 0


class RunDetail(RunResponse):
    nodes: list[NodeRunDetail] = []
