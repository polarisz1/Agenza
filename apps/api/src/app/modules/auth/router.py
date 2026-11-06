"""Auth FastAPI router - /api/v1/auth/* endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.exceptions import AppError
from app.core.response import (
    ERROR_RESPONSES,
    ApiResponse,
    DeleteResult,
    success,
)
from app.modules.auth.dependencies import (
    get_current_user,
    get_current_workspace,
    require_role,
)
from app.modules.auth.models import User
from app.modules.auth.schemas import (
    ApiKeyCreateRequest,
    ApiKeyCreateResponse,
    ApiKeyListData,
    CurrentUserResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.modules.auth.service import ApiKeyService, AuthService

router = APIRouter(prefix="/auth", responses=ERROR_RESPONSES, tags=["auth"])
api_key_router = APIRouter(prefix="/api-keys", responses=ERROR_RESPONSES, tags=["api-keys"])


@router.post("/register", response_model=ApiResponse[TokenResponse])
def register(body: RegisterRequest, session: Session = Depends(get_session)):
    result = AuthService.register(session, body)
    return success(result)


@router.post("/login", response_model=ApiResponse[TokenResponse])
def login(body: LoginRequest, session: Session = Depends(get_session)):
    result = AuthService.login(session, body.email, body.password)
    return success(result)


@router.post("/refresh", response_model=ApiResponse[TokenResponse])
def refresh(body: RefreshRequest, session: Session = Depends(get_session)):
    result = AuthService.refresh(session, body.refresh_token)
    return success(result)


@router.get("/me", response_model=ApiResponse[CurrentUserResponse])
def me(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = AuthService.current_user(session, current_user.id)
    return success(result)


# ── API Keys（外部 HTTP 触发凭据） ────────────────────────────────


@api_key_router.get("", response_model=ApiResponse[ApiKeyListData])
def list_api_keys(
    session: Session = Depends(get_session),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner")),
):
    return success(ApiKeyService.list(session, workspace.id))


@api_key_router.post("", response_model=ApiResponse[ApiKeyCreateResponse], status_code=201)
def create_api_key(
    body: ApiKeyCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner")),
):
    result = ApiKeyService.create(
        session,
        workspace_id=workspace.id,
        user_id=current_user.id,
        body=body,
    )
    return success(result, code=201)


@api_key_router.delete("/{key_id}", response_model=ApiResponse[DeleteResult])
def revoke_api_key(
    key_id: str,
    session: Session = Depends(get_session),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("owner")),
):
    if not ApiKeyService.revoke(session, workspace.id, key_id):
        raise AppError(404, "API Key not found")
    return success(DeleteResult(deleted=True))
