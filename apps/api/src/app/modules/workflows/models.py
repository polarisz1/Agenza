"""Workflow SQLAlchemy model."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text

from app.db.database import Base


class Workflow(Base):
    __tablename__ = "workflow"

    id = Column(String(12), primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), default="draft")  # draft | ready
    graph_json = Column(Text, nullable=False, default="{}")
    viewport_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_run_at = Column(DateTime, nullable=True)
