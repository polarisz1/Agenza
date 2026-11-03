"""Auth repository - User, Workspace, WorkspaceMember, ApiKey CRUD."""

from __future__ import annotations

from collections.abc import Sequence

from app.modules.auth.models import ApiKey, User, Workspace, WorkspaceMember
from sqlalchemy.orm import Session


class UserRepository:
    @staticmethod
    def create(session: Session, *, email: str, password_hash: str, name: str) -> User:
        obj = User(email=email, password_hash=password_hash, name=name)
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def get_by_email(session: Session, email: str) -> User | None:
        return session.query(User).filter(User.email == email).first()

    @staticmethod
    def get_by_id(session: Session, user_id: str) -> User | None:
        return session.get(User, user_id)

    @staticmethod
    def update_login(session: Session, user_id: str) -> None:
        from app.core.time import utcnow

        u = session.get(User, user_id)
        if u:
            u.last_login_at = utcnow()
            session.flush()


class WorkspaceRepository:
    @staticmethod
    def create(session: Session, *, name: str, owner_id: str, description: str | None = None) -> Workspace:
        obj = Workspace(name=name, owner_id=owner_id, description=description)
        session.add(obj)
        session.flush()
        session.refresh(obj)
        # 自动把创建者设为 Owner
        session.add(WorkspaceMember(workspace_id=obj.id, user_id=owner_id, role="owner"))
        session.flush()
        return obj

    @staticmethod
    def get(session: Session, workspace_id: str) -> Workspace | None:
        return session.get(Workspace, workspace_id)

    @staticmethod
    def list_by_user(session: Session, user_id: str) -> Sequence[Workspace]:
        return (
            session.query(Workspace)
            .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
            .filter(WorkspaceMember.user_id == user_id)
            .all()
        )

    @staticmethod
    def member_count(session: Session, workspace_id: str) -> int:
        return (
            session.query(WorkspaceMember)
            .filter(WorkspaceMember.workspace_id == workspace_id)
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
        obj = WorkspaceMember(
            workspace_id=workspace_id, user_id=user_id, role=role, invited_by=invited_by
        )
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def list(session: Session, workspace_id: str) -> Sequence[WorkspaceMember]:
        return (
            session.query(WorkspaceMember)
            .filter(WorkspaceMember.workspace_id == workspace_id)
            .all()
        )

    @staticmethod
    def update_role(session: Session, workspace_id: str, user_id: str, role: str) -> bool:
        obj = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if obj is None:
            return False
        obj.role = role
        session.flush()
        return True

    @staticmethod
    def remove(session: Session, workspace_id: str, user_id: str) -> bool:
        obj = WorkspaceMemberRepository.get(session, workspace_id, user_id)
        if obj is None:
            return False
        session.delete(obj)
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
        )
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def list(session: Session, workspace_id: str) -> Sequence[ApiKey]:
        return session.query(ApiKey).filter(ApiKey.workspace_id == workspace_id).all()

    @staticmethod
    def get_by_hash(session: Session, key_hash: str) -> ApiKey | None:
        return session.query(ApiKey).filter(ApiKey.key_hash == key_hash, ApiKey.enabled.is_(True)).first()

    @staticmethod
    def delete(session: Session, key_id: str, workspace_id: str) -> bool:
        obj = (
            session.query(ApiKey)
            .filter(ApiKey.id == key_id, ApiKey.workspace_id == workspace_id)
            .first()
        )
        if obj is None:
            return False
        session.delete(obj)
        session.flush()
        return True
