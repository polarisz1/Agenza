"""Workspaces service - 工作空间 CRUD + 成员邀请/移除/角色变更."""

from __future__ import annotations

from app.core.exceptions import AppError
from app.modules.auth.models import WorkspaceMember
from app.modules.auth.repository import (
    UserRepository,
    WorkspaceMemberRepository,
    WorkspaceRepository,
)
from app.modules.workspaces.schemas import (
    MemberInviteRequest,
    MemberRoleUpdate,
    WorkspaceCreate,
    WorkspaceListData,
    WorkspaceMemberItem,
    WorkspaceResponse,
    WorkspaceUpdate,
)
from sqlalchemy.orm import Session


class WorkspaceService:
    @staticmethod
    def list_for_user(session: Session, user_id: str) -> WorkspaceListData:
        """列出用户属于的所有工作空间。"""
        workspaces = WorkspaceRepository.list_by_user(session, user_id)
        items = []
        for ws in workspaces:
            member = WorkspaceMemberRepository.get(session, ws.id, user_id)
            owner = UserRepository.get_by_id(session, ws.owner_id)
            count = WorkspaceRepository.member_count(session, ws.id)
            items.append(
                WorkspaceResponse(
                    id=ws.id,
                    name=ws.name,
                    description=ws.description,
                    owner_id=ws.owner_id,
                    owner_name=owner.name if owner else None,
                    plan=ws.plan,
                    member_count=count,
                    my_role=member.role if member else "viewer",
                    created_at=ws.created_at,
                )
            )
        return WorkspaceListData(items=items)

    @staticmethod
    def get(session: Session, workspace_id: str, user_id: str) -> WorkspaceResponse:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        member = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if member is None:
            raise AppError(403, "您无权访问该工作空间")
        owner = UserRepository.get_by_id(session, ws.owner_id)
        count = WorkspaceRepository.member_count(session, ws.id)
        return WorkspaceResponse(
            id=ws.id,
            name=ws.name,
            description=ws.description,
            owner_id=ws.owner_id,
            owner_name=owner.name if owner else None,
            plan=ws.plan,
            member_count=count,
            my_role=member.role,
            created_at=ws.created_at,
        )

    @staticmethod
    def create(session: Session, body: WorkspaceCreate, owner_id: str) -> WorkspaceResponse:
        ws = WorkspaceRepository.create(
            session, name=body.name, description=body.description, owner_id=owner_id
        )
        session.commit()
        return WorkspaceResponse(
            id=ws.id,
            name=ws.name,
            description=ws.description,
            owner_id=ws.owner_id,
            plan=ws.plan,
            member_count=1,
            my_role="owner",
            created_at=ws.created_at,
        )

    @staticmethod
    def update(
        session: Session,
        workspace_id: str,
        body: WorkspaceUpdate,
        user_id: str,
    ) -> WorkspaceResponse:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        member = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if member is None:
            raise AppError(403, "您无权访问该工作空间")
        if member.role != "owner":
            raise AppError(403, "只有 Owner 可以修改工作空间")

        if body.name is not None:
            ws.name = body.name
        if body.description is not None:
            ws.description = body.description
        session.flush()
        session.commit()

        return WorkspaceService.get(session, workspace_id, user_id)

    @staticmethod
    def delete(session: Session, workspace_id: str, user_id: str) -> None:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        member = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if member is None or member.role != "owner":
            raise AppError(403, "只有 Owner 可以解散工作空间")

        # 级联删除成员
        members = WorkspaceMemberRepository.list(session, workspace_id)
        for m in members:
            session.delete(m)
        session.delete(ws)
        session.commit()

    # ── 成员管理 ──────────────────────────────────────────────

    @staticmethod
    def list_members(session: Session, workspace_id: str, user_id: str) -> list[WorkspaceMemberItem]:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        member = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if member is None:
            raise AppError(403, "您无权访问该工作空间")

        items = []
        for m in WorkspaceMemberRepository.list(session, workspace_id):
            user = UserRepository.get_by_id(session, m.user_id)
            inviter = UserRepository.get_by_id(session, m.invited_by) if m.invited_by else None
            items.append(
                WorkspaceMemberItem(
                    user_id=m.user_id,
                    email=user.email if user else "",
                    name=user.name if user else "",
                    avatar_url=user.avatar_url if user else None,
                    role=m.role,
                    joined_at=m.joined_at,
                    invited_by_name=inviter.name if inviter else None,
                )
            )
        return items

    @staticmethod
    def invite_member(
        session: Session,
        workspace_id: str,
        body: MemberInviteRequest,
        inviter_id: str,
    ) -> WorkspaceMemberItem:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        inviter = WorkspaceMemberRepository.get(session, workspace_id, inviter_id)
        if inviter is None or inviter.role not in ("owner", "editor"):
            raise AppError(403, "只有 Owner/Editor 可以邀请成员")

        # 查找或创建用户
        user = UserRepository.get_by_email(session, body.email)
        if user is None:
            # 暂不支持邀请未注册用户（Phase 1 简化）
            raise AppError(404, "该用户尚未注册 AgentFlow")

        existing = WorkspaceMemberRepository.get(session, workspace_id, user.id)
        if existing:
            raise AppError(409, "该用户已是工作空间成员")

        WorkspaceMemberRepository.add(
            session,
            workspace_id=workspace_id,
            user_id=user.id,
            role=body.role,
            invited_by=inviter_id,
        )

        # 审计日志：邀请成员
        from app.modules.audit.service import log_action

        log_action(
            session,
            "workspace.member_invite",
            resource_type="workspace",
            resource_id=workspace_id,
            workspace_id=workspace_id,
            detail=f"邀请 {user.email} 加入工作空间（角色：{body.role}）",
        )
        session.commit()

        return WorkspaceMemberItem(
            user_id=user.id,
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            role=body.role,
            joined_at=session.query(WorkspaceMember).filter(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user.id,
            ).one().joined_at,
            invited_by_name=UserRepository.get_by_id(session, inviter_id).name,
        )

    @staticmethod
    def update_member_role(
        session: Session,
        workspace_id: str,
        target_user_id: str,
        body: MemberRoleUpdate,
        operator_id: str,
    ) -> None:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        operator = WorkspaceMemberRepository.get(session, workspace_id, operator_id)
        if operator is None or operator.role != "owner":
            raise AppError(403, "只有 Owner 可以修改成员角色")

        # Owner 不能被降级
        target = WorkspaceMemberRepository.get(session, workspace_id, target_user_id)
        if target is None:
            raise AppError(404, "成员不存在")
        if target.role == "owner" and operator_id != target_user_id:
            raise AppError(400, "不能修改 Owner 的角色")

        WorkspaceMemberRepository.update_role(session, workspace_id, target_user_id, body.role)
        session.commit()

    @staticmethod
    def remove_member(
        session: Session,
        workspace_id: str,
        target_user_id: str,
        operator_id: str,
    ) -> None:
        ws = WorkspaceRepository.get(session, workspace_id)
        if ws is None:
            raise AppError(404, "工作空间不存在")
        operator = WorkspaceMemberRepository.get(session, workspace_id, operator_id)
        if operator is None or operator.role != "owner":
            raise AppError(403, "只有 Owner 可以移除成员")

        target = WorkspaceMemberRepository.get(session, workspace_id, target_user_id)
        if target is None:
            raise AppError(404, "成员不存在")
        if target.role == "owner":
            raise AppError(400, "不能移除 Owner")

        WorkspaceMemberRepository.remove(session, workspace_id, target_user_id)
        session.commit()
