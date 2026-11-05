"""AI Gateway repository：预算配置与路由策略的持久化（GATE-01）。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.tenancy import get_tenant, get_workspace_id
from app.modules.gateway.models import GatewayConfig, GatewayRoute


def _ws_id() -> str | None:
    ws = get_workspace_id()
    return str(ws) if ws is not None else None


def _user_id() -> str | None:
    tenant = get_tenant()
    return str(tenant.user_id) if tenant is not None else None


class GatewayConfigRepository:
    @staticmethod
    def get(session: Session) -> GatewayConfig | None:
        q = session.query(GatewayConfig).filter(GatewayConfig.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            q = q.filter(GatewayConfig.workspace_id == ws)
        return q.first()

    @staticmethod
    def create(session: Session) -> GatewayConfig:
        obj = GatewayConfig(
            workspace_id=_ws_id(),
            created_by=_user_id(),
            updated_by=_user_id(),
        )
        session.add(obj)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def update(session: Session, fields: dict) -> GatewayConfig:
        obj = GatewayConfigRepository.get(session)
        if obj is None:
            obj = GatewayConfigRepository.create(session)
        for key, value in fields.items():
            if value is not None:
                setattr(obj, key, value)
        actor = _user_id()
        if actor is not None:
            obj.updated_by = actor
        session.flush()
        session.refresh(obj)
        return obj


class GatewayRouteRepository:
    @staticmethod
    def list(session: Session, *, enabled_only: bool = False) -> list[GatewayRoute]:
        q = session.query(GatewayRoute).filter(GatewayRoute.deleted_at.is_(None))
        ws = _ws_id()
        if ws is not None:
            q = q.filter(GatewayRoute.workspace_id == ws)
        if enabled_only:
            q = q.filter(GatewayRoute.enabled.is_(True))
        return q.order_by(GatewayRoute.task_type.asc()).all()

    @staticmethod
    def get(session: Session, route_id: str) -> GatewayRoute | None:
        q = session.query(GatewayRoute).filter(
            GatewayRoute.id == route_id, GatewayRoute.deleted_at.is_(None)
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(GatewayRoute.workspace_id == ws)
        return q.first()

    @staticmethod
    def get_by_task(session: Session, task_type: str) -> GatewayRoute | None:
        q = session.query(GatewayRoute).filter(
            GatewayRoute.task_type == task_type, GatewayRoute.deleted_at.is_(None)
        )
        ws = _ws_id()
        if ws is not None:
            q = q.filter(GatewayRoute.workspace_id == ws)
        return q.first()

    @staticmethod
    def upsert(session: Session, fields: dict) -> GatewayRoute:
        """同一 workspace 内一个 task_type 只保留一条策略。"""
        obj = GatewayRouteRepository.get_by_task(session, fields["task_type"])
        if obj is None:
            obj = GatewayRoute(
                workspace_id=_ws_id(),
                created_by=_user_id(),
                updated_by=_user_id(),
                **fields,
            )
            session.add(obj)
        else:
            for key, value in fields.items():
                setattr(obj, key, value)
            obj.updated_by = _user_id()
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, route_id: str) -> bool:
        obj = GatewayRouteRepository.get(session, route_id)
        if obj is None:
            return False
        from app.core.time import utcnow

        obj.deleted_at = utcnow()
        obj.updated_by = _user_id()
        session.flush()
        return True
