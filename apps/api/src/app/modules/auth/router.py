"""Auth FastAPI router - /api/v1/auth/* endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.response import ERROR_RESPONSES, ApiResponse, success
from app.modules.auth.dependencies import get_current_user, get_current_workspace
from app.modules.auth.models import User, Workspace
from app.modules.auth.schemas import (
    CurrentUserResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
)
from app.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", responses=ERROR_RESPONSES, tags=["auth"])


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
