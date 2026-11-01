"""Workflow SQLAlchemy model."""

from __future__ import annotations

from sqlalchemy import Column, DateTime, Integer, String, Text

from app.core.time import utcnow
from app.db.database import Base


class Workflow(Base):
    __tablename__ = "workflow"

    id = Column(String(12), primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text, nullable=True)
    status = Column(String(20), default="draft")  # draft | ready
    graph_json = Column(Text, nullable=False, default="{}")
    viewport_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    last_run_at = Column(DateTime, nullable=True)


class WorkflowVersion(Base):
    """工作流版本快照（F5）：每次图内容变化保存一版，保留最近 50 版。"""

    __tablename__ = "workflow_version"

    id = Column(String(24), primary_key=True)
    workflow_id = Column(String(12), nullable=False, index=True)
    seq = Column(Integer, nullable=False)  # 每个工作流内递增，用于展示 v1/v2
    summary = Column(String(200), nullable=True)
    graph_json = Column(Text, nullable=False)
    viewport_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)
