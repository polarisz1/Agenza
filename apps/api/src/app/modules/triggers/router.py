"""TRIGGER-01：HTTP 触发路由。

认证走 `X-API-Key`，不使用 JWT；租户上下文由 `require_api_key` 注入，
`TenantMiddleware` 在请求结束后统一清理。
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Header
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.response import ERROR_RESPONSES, ApiResponse, success
from app.modules.auth.dependencies import ApiKeyContext, require_api_key
from app.modules.triggers.schemas import HttpTriggerRequest, TriggerRunResponse
from app.modules.triggers.service import TriggerService

router = APIRouter(prefix="/triggers", responses=ERROR_RESPONSES, tags=["triggers"])


@router.post(
    "/http/{workflow_id}",
    response_model=ApiResponse[TriggerRunResponse],
    status_code=202,
)
def trigger_http(
    workflow_id: str,
    body: HttpTriggerRequest,
    background: BackgroundTasks,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    session: Session = Depends(get_session),
    ctx: ApiKeyContext = Depends(require_api_key),
):
    """用 API Key 触发已发布工作流：立即返回 202 + run_id。"""
    result = TriggerService.trigger_http(
        session,
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        workflow_id=workflow_id,
        inputs=body.inputs,
        background=background,
        idempotency_key=idempotency_key,
    )
    return success(result, code=202)
