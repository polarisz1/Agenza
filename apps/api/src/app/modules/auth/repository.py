"""Auth repository - User, Workspace, WorkspaceMember, ApiKey CRUD."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.modules.auth.models import ApiKey, User, Workspace, WorkspaceMember


class UserRepository:
    @staticmethod
    def create(session: Session, *, email: str, password_hash: str, name: str) -> User:
        obj = User(email=email, password_hash=password_hash, name=name)
        session.add(obj)
        session.flush()
        # 自助注册：创建人/更新人就是用户自己
        obj.created_by = obj.id
        obj.updated_by = obj.id
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def get_by_email(session: Session, email: str) -> User | None:
        return (
            session.query(User)
            .filter(User.email == email, User.deleted_at.is_(None))
            .first()
        )

    @staticmethod
    def get_by_id(session: Session, user_id: str) -> User | None:
        return (
            session.query(User)
            .filter(User.id == user_id, User.deleted_at.is_(None))
            .first()
        )

    @staticmethod
    def update_login(session: Session, user_id: str) -> None:
        from app.core.time import utcnow

        u = UserRepository.get_by_id(session, user_id)
        if u:
            u.last_login_at = utcnow()
            u.updated_by = user_id
            session.flush()


class WorkspaceRepository:
    @staticmethod
    def create(session: Session, *, name: str, owner_id: str, description: str | None = None) -> Workspace:
        obj = Workspace(
            name=name,
            owner_id=owner_id,
            description=description,
            created_by=owner_id,
            updated_by=owner_id,
        )
        session.add(obj)
        session.flush()
        session.refresh(obj)
        # 自动把创建者设为 Owner
        session.add(
            WorkspaceMember(
                workspace_id=obj.id,
                user_id=owner_id,
                role="owner",
                created_by=owner_id,
                updated_by=owner_id,
            )
        )
        session.flush()
        return obj

    @staticmethod
    def get(session: Session, workspace_id: str) -> Workspace | None:
        return (
            session.query(Workspace)
            .filter(Workspace.id == workspace_id, Workspace.deleted_at.is_(None))
            .first()
        )

    @staticmethod
    def list_by_user(session: Session, user_id: str) -> Sequence[Workspace]:
        return (
            session.query(Workspace)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .filter(
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.deleted_at.is_(None),
                Workspace.deleted_at.is_(None),
            )
            .all()
        )

    @staticmethod
    def member_count(session: Session, workspace_id: str) -> int:
        return (
            session.query(WorkspaceMember)
            .filter(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.deleted_at.is_(None),
            )
            .count()
        )


class WorkspaceMemberRepository:
    @staticmethod
    def get(session: Session, workspace_id: str, user_id: str) -> WorkspaceMember | None:
        return (
            session.query(WorkspaceMember)
            .filter(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
                WorkspaceMember.deleted_at.is_(None),
            )
            .first()
        )

    @staticmethod
    def _get_any(session: Session, workspace_id: str, user_id: str) -> WorkspaceMember | None:
        """包含已软删除的成员行，用于重新邀请时恢复。"""
        return (
            session.query(WorkspaceMember)
            .filter(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == user_id,
            )
            .first()
        )

    @staticmethod
    def add(
        session: Session,
        *,
        workspace_id: str,
        user_id: str,
        role: str,
        invited_by: str | None = None,
    ) -> WorkspaceMember:
        obj = WorkspaceMemberRepository._get_any(session, workspace_id, user_id)
        if obj is None:
            obj = WorkspaceMember(
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                invited_by=invited_by,
                created_by=invited_by,
                updated_by=invited_by,
            )
            session.add(obj)
        else:
            # 软删除后重新邀请：恢复同一行，避免联合主键冲突
            obj.role = role
            obj.invited_by = invited_by
            obj.deleted_at = None
            obj.created_by = obj.created_by or invited_by
            obj.updated_by = invited_by
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def list(session: Session, workspace_id: str) -> Sequence[WorkspaceMember]:
        return (
            session.query(WorkspaceMember)
            .filter(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.deleted_at.is_(None),
            )
            .all()
        )

    @staticmethod
    def update_role(
        session: Session,
        workspace_id: str,
        user_id: str,
        role: str,
        actor_id: str | None = None,
    ) -> bool:
        obj = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if obj is None:
            return False
        obj.role = role
        obj.updated_by = actor_id
        session.flush()
        return True

    @staticmethod
    def remove(
        session: Session,
        workspace_id: str,
        user_id: str,
        actor_id: str | None = None,
    ) -> bool:
        obj = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if obj is None:
            return False
        from app.core.time import utcnow

        obj.deleted_at = utcnow()
        obj.updated_by = actor_id
        session.flush()
        return True


class ApiKeyRepository:
    @staticmethod
    def create(
        session: Session,
        *,
        workspace_id: str,
        user_id: str,
        name: str,
        key_hash: str,
        key_prefix: str,
        expires_at=None,
    ) -> ApiKey:
        obj = ApiKey(
            workspace_id=workspace_id,
            user_id=user_id,
            name=name,
            key_hash=key_hash,
            key_prefix=key_prefix,
            expires_at=expires_at,
            created_by=user_id,
            updated_by=user_id,
        )
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def list(session: Session, workspace_id: str) -> Sequence[ApiKey]:
        return (
            session.query(ApiKey)
            .filter(
                ApiKey.workspace_id == workspace_id,
                ApiKey.deleted_at.is_(None),
            )
            .all()
        )

    @staticmethod
    def get_by_hash(session: Session, key_hash: str) -> ApiKey | None:
        return (
            session.query(ApiKey)
            .filter(
                ApiKey.key_hash == key_hash,
                ApiKey.enabled.is_(True),
                ApiKey.deleted_at.is_(None),
            )
            .first()
        )

    @staticmethod
    def delete(session: Session, key_id: str, workspace_id: str) -> bool:
        from app.core.time import utcnow

        obj = (
            session.query(ApiKey)
            .filter(
                ApiKey.id == key_id,
                ApiKey.workspace_id == workspace_id,
                ApiKey.deleted_at.is_(None),
            )
            .first()
        )
        if obj is None:
            return False
        obj.deleted_at = utcnow()
        obj.enabled = False
        obj.updated_by = obj.user_id
        session.flush()
        return True
