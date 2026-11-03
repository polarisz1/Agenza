"""Provider repository.

SaaS 多租户：模型密钥按 workspace 归属；桌面模式 workspace_id 为 None（全局）。
"""

from __future__ import annotations

from app.core.tenancy import get_workspace_id
from app.modules.providers.models import Provider
from sqlalchemy.orm import Session


def _ws_id() -> str | None:
    ws = get_workspace_id()
    return str(ws) if ws is not None else None


class ProviderRepository:
    @staticmethod
    def create(session: Session, p: Provider) -> Provider:
        if p.workspace_id is None:
            p.workspace_id = _ws_id()
        session.add(p)
        session.flush()
        session.refresh(p)
        return p

    @staticmethod
    def get(session: Session, pid: str) -> Provider | None:
        q = session.query(Provider).filter(Provider.id == pid)
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Provider.workspace_id == ws)
        return q.first()

    @staticmethod
    def list(session: Session) -> list[Provider]:
        q = session.query(Provider)
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Provider.workspace_id == ws)
        return q.order_by(Provider.created_at.desc()).all()

    @staticmethod
    def list_enabled(session: Session) -> list[Provider]:
        q = session.query(Provider).filter(Provider.enabled == True)  # noqa: E712
        ws = _ws_id()
        if ws is not None:
            q = q.filter(Provider.workspace_id == ws)
        return q.all()

    @staticmethod
    def update(session: Session, pid: str, **fields) -> Provider | None:
        obj = ProviderRepository.get(session, pid)
        if not obj:
            return None
        for k, v in fields.items():
            setattr(obj, k, v)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, pid: str) -> bool:
        obj = ProviderRepository.get(session, pid)
        if not obj:
            return False
        session.delete(obj)
        session.flush()
        return True
