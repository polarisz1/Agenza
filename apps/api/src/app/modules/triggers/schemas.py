"""TRIGGER-01：HTTP 触发 schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class HttpTriggerRequest(BaseModel):
    """HTTP 触发的请求体：inputs 直接映射到工作流输入。"""

    inputs: dict[str, Any] = Field(default_factory=dict)


class TriggerRunResponse(BaseModel):
    run_id: str
    workflow_id: str
    workflow_name: str
    status: str
    trigger: str
    # 相同 Idempotency-Key 命中已有请求时为 True
    deduplicated: bool = False


# ── Phase C：Webhook 触发器管理 ───────────────────────────────────


class WebhookTriggerCreate(BaseModel):
    workflow_id: str
    name: str = Field(..., min_length=1, max_length=200)
    # {"工作流输入 key": "$.payload.path"}；为空表示请求体本身就是 inputs
    input_mapping: dict[str, str] | None = None
    enabled: bool = True


class WebhookTriggerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    input_mapping: dict[str, str] | None = None
    enabled: bool | None = None


class WebhookTriggerItem(BaseModel):
    id: str
    workflow_id: str
    name: str
    enabled: bool
    input_mapping: dict[str, str] | None = None
    webhook_path: str
    last_triggered_at: datetime | None = None
    created_at: datetime


class WebhookTriggerCreated(WebhookTriggerItem):
    # 只在创建/轮换时返回一次
    secret: str


class WebhookTriggerListData(BaseModel):
    items: list[WebhookTriggerItem]
