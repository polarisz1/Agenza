"""Workspaces FastAPI router - /api/v1/workspaces/* endpoints."""

from __future__ import annotations

from app.api_deps import get_session
from app.core.response import ERROR_RESPONSES, ApiResponse, DeleteResult, success
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.models import User
from app.modules.workspaces.schemas import (
    MemberInviteRequest,
    MemberRoleUpdate,
    WorkspaceCreate,
    WorkspaceListData,
    WorkspaceMemberItem,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from app.modules.workspaces.service import WorkspaceService
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

router = APIRouter(prefix="/workspaces", responses=ERROR_RESPONSES, tags=["workspaces"])


@router.get("", response_model=ApiResponse[WorkspaceListData])
def list_workspaces(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = WorkspaceService.list_for_user(session, current_user.id)
    return success(result)


@router.post("", response_model=ApiResponse[WorkspaceResponse])
def create_workspace(
    body: WorkspaceCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = WorkspaceService.create(session, body, current_user.id)
    return success(result)


@router.get("/{workspace_id}", response_model=ApiResponse[WorkspaceResponse])
def get_workspace(
    workspace_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = WorkspaceService.get(session, workspace_id, current_user.id)
    return success(result)


@router.put("/{workspace_id}", response_model=ApiResponse[WorkspaceResponse])
def update_workspace(
    workspace_id: str,
    body: WorkspaceUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = WorkspaceService.update(session, workspace_id, body, current_user.id)
    return success(result)


@router.delete("/{workspace_id}", response_model=ApiResponse[DeleteResult])
def delete_workspace(
    workspace_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    WorkspaceService.delete(session, workspace_id, current_user.id)
    return success({"deleted": True})


# ── Members ────────────────────────────────────────────────────


@router.get("/{workspace_id}/members", response_model=ApiResponse[list[WorkspaceMemberItem]])
def list_members(
    workspace_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = WorkspaceService.list_members(session, workspace_id, current_user.id)
    return success(result)


@router.post("/{workspace_id}/members", response_model=ApiResponse[WorkspaceMemberItem])
def invite_member(
    workspace_id: str,
    body: MemberInviteRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = WorkspaceService.invite_member(
        session, workspace_id, body, inviter_id=current_user.id
    )
    return success(result)


@router.put("/{workspace_id}/members/{user_id}", response_model=ApiResponse[WorkspaceMemberItem])
def update_member_role(
    workspace_id: str,
    user_id: str,
    body: MemberRoleUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    WorkspaceService.update_member_role(
        session, workspace_id, user_id, body, operator_id=current_user.id
    )
    # 返回最新状态
    items = WorkspaceService.list_members(session, workspace_id, current_user.id)
    target = next((m for m in items if m.user_id == user_id), None)
    return success(target)


@router.delete("/{workspace_id}/members/{user_id}", response_model=ApiResponse[DeleteResult])
def remove_member(
    workspace_id: str,
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    WorkspaceService.remove_member(
        session, workspace_id, user_id, operator_id=current_user.id
    )
    return success({"deleted": True})
