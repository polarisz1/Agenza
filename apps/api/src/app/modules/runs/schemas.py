"""Run Pydantic schemas."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

# `waiting_input` 是"人工确认"预留态（D 组明确不在 v0.1/v0.2 范围，引擎从不产生）。
# 契约保留它以免将来加人工节点时改枚举；前端已给中文映射（评审 G23），
# 因此历史库/外部写入出现过该值时不会显示英文原值。
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
    # 本次运行使用的图版本（F5）；老运行没有记录
    version_id: str | None = None
    version_seq: int | None = None


class RunListItem(BaseModel):
    id: str
    workflow_id: str
    workflow_name: str
    status: RunStatus
    trigger: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    total_tokens: int = 0


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
    # 这次运行实际使用的输入（F1：运行详情右侧需要回看）
    inputs: dict = {}
    nodes: list[NodeRunDetail] = []


class CompareNode(BaseModel):
    """运行对比里的一行：按 node_id 对齐两次运行。"""

    node_id: str
    node_name: str
    node_type: str
    a: NodeRunDetail | None = None
    b: NodeRunDetail | None = None


class RunCompareResult(BaseModel):
    a: RunDetail
    b: RunDetail
    nodes: list[CompareNode] = []


# ── GATE-04：自动根因分析（确定性规则） ─────────────────────────


DiagnosisCategory = Literal[
    "budget",
    "auth",
    "model_not_found",
    "rate_limit",
    "timeout",
    "network",
    "provider",
    "json_format",
    "missing_fields",
    "variable",
    "script",
    "upstream",
    "internal",
    "unknown",
]


class DiagnosisEvidence(BaseModel):
    label: str
    value: str


class DiagnosisSuggestion(BaseModel):
    text: str
    # 前端可据此决定按钮/跳转：edit_prompt | open_node | retry_node | open_models | open_gateway
    action: str | None = None


class NodeDiagnosis(BaseModel):
    node_id: str
    node_name: str
    node_type: str
    status: str
    category: DiagnosisCategory
    severity: Literal["blocking", "warning"]
    title: str
    root_cause: str
    confidence: float
    evidence: list[DiagnosisEvidence] = []
    suggestions: list[DiagnosisSuggestion] = []


class RunDiagnosisResponse(BaseModel):
    run_id: str
    workflow_id: str
    status: str
    generated_at: datetime
    items: list[NodeDiagnosis] = []


class DeepDiagnosisResponse(BaseModel):
    """AI 深度分析结果（GATE-04 Phase 2，按需调用模型）。"""

    run_id: str
    workflow_id: str
    status: str
    analysis: str
    provider_id: str | None = None
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    cached: bool = False
    generated_at: datetime
