"""TRIGGER-01：HTTP 触发 schema。"""

from __future__ import annotations

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
