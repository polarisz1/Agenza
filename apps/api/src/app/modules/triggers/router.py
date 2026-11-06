"""TRIGGER-01：HTTP / Webhook 触发路由。

- `/api/v1/triggers/http/{workflow_id}`：API Key 认证（Phase B）；
- `/api/v1/triggers`：JWT 管理工作流级 Webhook 触发器（Phase C）；
- `/api/v1/webhooks/{trigger_id}`：HMAC 签名认证的公网入口。
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.exceptions import AppError
from app.core.response import ERROR_RESPONSES, ApiResponse, DeleteResult, success
from app.modules.auth.dependencies import (
    ApiKeyContext,
    get_current_workspace,
    require_api_key,
    require_role,
)
from app.modules.triggers.schemas import (
    HttpTriggerRequest,
    TriggerRunResponse,
    WebhookTriggerCreate,
    WebhookTriggerCreated,
    WebhookTriggerItem,
    WebhookTriggerListData,
    WebhookTriggerUpdate,
)
from app.modules.triggers.service import TriggerAdminService, TriggerService

router = APIRouter(prefix="/triggers", responses=ERROR_RESPONSES, tags=["triggers"])
webhook_router = APIRouter(prefix="/webhooks", responses=ERROR_RESPONSES, tags=["webhooks"])


# ── Phase B：HTTP 触发（API Key） ──────────────────────────────────


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


# ── Phase C：Webhook 触发器管理（JWT） ────────────────────────────


@router.get("", response_model=ApiResponse[WebhookTriggerListData])
def list_triggers(
    workflow_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
    _workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner", "editor")),
):
    return success(TriggerAdminService.list(session, workflow_id))


@router.post("", response_model=ApiResponse[WebhookTriggerCreated], status_code=201)
def create_trigger(
    body: WebhookTriggerCreate,
    session: Session = Depends(get_session),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner", "editor")),
):
    result = TriggerAdminService.create(session, workspace_id=workspace.id, body=body)
    return success(result, code=201)


@router.patch("/{trigger_id}", response_model=ApiResponse[WebhookTriggerItem])
def update_trigger(
    trigger_id: str,
    body: WebhookTriggerUpdate,
    session: Session = Depends(get_session),
    _workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner", "editor")),
):
    return success(TriggerAdminService.update(session, trigger_id, body))


@router.delete("/{trigger_id}", response_model=ApiResponse[DeleteResult])
def delete_trigger(
    trigger_id: str,
    session: Session = Depends(get_session),
    _workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner", "editor")),
):
    if not TriggerAdminService.delete(session, trigger_id):
        raise AppError(404, "Webhook trigger not found")
    return success(DeleteResult(deleted=True))


@router.post(
    "/{trigger_id}/rotate-secret",
    response_model=ApiResponse[WebhookTriggerCreated],
)
def rotate_trigger_secret(
    trigger_id: str,
    session: Session = Depends(get_session),
    _workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner", "editor")),
):
    return success(TriggerAdminService.rotate_secret(session, trigger_id))


# ── Phase C：公网 Webhook 入口（HMAC） ────────────────────────────


@webhook_router.post(
    "/{trigger_id}",
    response_model=ApiResponse[TriggerRunResponse],
    status_code=202,
)
async def receive_webhook(
    trigger_id: str,
    request: Request,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
):
    raw_body = await request.body()
    result = TriggerService.handle_webhook(
        session,
        trigger_id=trigger_id,
        raw_body=raw_body,
        timestamp=request.headers.get("x-agentflow-timestamp"),
        signature=request.headers.get("x-agentflow-signature"),
        idempotency_key=request.headers.get("x-idempotency-key")
        or request.headers.get("x-github-delivery"),
        background=background,
    )
    return success(result, code=202)
