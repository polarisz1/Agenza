"""审计日志模型"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from app.db.database import Base
from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: uuid4().hex)
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
