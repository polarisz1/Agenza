"""Provider repository."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.providers.models import Provider


class ProviderRepository:
    @staticmethod
    def create(session: Session, p: Provider) -> Provider:
        session.add(p)
        session.flush()
        session.refresh(p)
        return p

    @staticmethod
    def get(session: Session, pid: str) -> Provider | None:
        return session.get(Provider, pid)

    @staticmethod
    def list(session: Session) -> list[Provider]:
        return session.query(Provider).order_by(Provider.created_at.desc()).all()

    @staticmethod
    def list_enabled(session: Session) -> list[Provider]:
        return session.query(Provider).filter(Provider.enabled == True).all()  # noqa: E712

    @staticmethod
    def update(session: Session, pid: str, **fields) -> Provider | None:
        obj = session.get(Provider, pid)
        if not obj:
            return None
        for k, v in fields.items():
            setattr(obj, k, v)
        session.flush()
        session.refresh(obj)
        return obj

    @staticmethod
    def delete(session: Session, pid: str) -> bool:
        obj = session.get(Provider, pid)
        if not obj:
            return False
        session.delete(obj)
        session.flush()
        return True
