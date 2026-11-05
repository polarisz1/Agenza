"""AI Gateway schemas（GATE-01）。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

TaskType = Literal["default", "extract", "long_text", "creative"]


class GatewayConfigResponse(BaseModel):
    enabled: bool
    monthly_budget_usd: float
    alert_threshold_pct: int
    hard_stop: bool
    # 当前自然月统计
    used_usd: float
    remaining_usd: float | None = None
    usage_pct: float = 0.0
    alert_triggered: bool = False
    hard_stopped: bool = False
    calls: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    period_start: datetime
    period_end: datetime


class GatewayConfigUpdate(BaseModel):
    enabled: bool | None = None
    monthly_budget_usd: float | None = Field(default=None, ge=0)
    alert_threshold_pct: int | None = Field(default=None, ge=1, le=100)
    hard_stop: bool | None = None


class GatewayRouteItem(BaseModel):
    id: str
    task_type: TaskType
    label: str | None = None
    primary_provider_id: str | None = None
    primary_model: str
    fallback_provider_id: str | None = None
    fallback_model: str | None = None
    input_price_per_1k: float = 0.0
    output_price_per_1k: float = 0.0
    fallback_input_price_per_1k: float = 0.0
    fallback_output_price_per_1k: float = 0.0
    enabled: bool = True


class GatewayRouteUpsert(BaseModel):
    task_type: TaskType
    label: str | None = Field(default=None, max_length=100)
    primary_provider_id: str | None = None
    primary_model: str = Field(..., min_length=1, max_length=200)
    fallback_provider_id: str | None = None
    fallback_model: str | None = Field(default=None, max_length=200)
    input_price_per_1k: float = Field(default=0.0, ge=0)
    output_price_per_1k: float = Field(default=0.0, ge=0)
    fallback_input_price_per_1k: float = Field(default=0.0, ge=0)
    fallback_output_price_per_1k: float = Field(default=0.0, ge=0)
    enabled: bool = True


class GatewayRouteListData(BaseModel):
    items: list[GatewayRouteItem]


class GatewayModelStat(BaseModel):
    model: str
    calls: int
    success_rate: float  # 0~1
    avg_latency_ms: int
    tokens_in: int
    tokens_out: int
    cost_usd: float


class GatewayUsageResponse(BaseModel):
    period_start: datetime
    period_end: datetime
    calls: int
    tokens_in: int
    tokens_out: int
    cost_usd: float
    models: list[GatewayModelStat]


class GatewayResolveResponse(BaseModel):
    """预览：当前策略下某个任务类型会选中谁。"""

    task_type: TaskType
    provider_id: str | None = None
    model: str | None = None
    source: str | None = None
    budget_exhausted: bool = False
    message: str | None = None
