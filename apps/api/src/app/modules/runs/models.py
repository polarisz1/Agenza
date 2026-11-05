"""Run module."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, text

from app.core.time import utcnow
from app.db.audit import AuditMixin
from app.db.database import Base


class Run(AuditMixin, Base):
    __tablename__ = "run"

    id = Column(String(32), primary_key=True, index=True)
    # SaaS: 多租户隔离字段
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=True, index=True)
    workflow_id = Column(String(32), index=True)
    workflow_name = Column(String(200))
    graph_snapshot = Column(Text, nullable=False)
    inputs_json = Column(Text, nullable=True)
    status = Column(String(20), default="running")  # running | success | failed | cancelled
    trigger = Column(String(20), default="manual")  # manual | debug | scheduled | api
    error = Column(Text, nullable=True)
    triggered_by = Column(String(36), ForeignKey("user.id"), nullable=True, index=True)
    started_at = Column(DateTime, default=utcnow, index=True)
    finished_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    total_tokens = Column(Integer, default=0)
    # 本次运行使用的图版本（F5）；老运行没有记录时为 NULL
    version_id = Column(String(24), nullable=True)
    version_seq = Column(Integer, nullable=True)

    # 同一工作流同时只允许一个 running 的运行（评审 G6）：
    # SQLite / PostgreSQL 用不同的部分唯一索引，保证语义一致
    __table_args__ = (
        Index(
            "uq_run_running_per_workflow",
            "workflow_id",
            unique=True,
            sqlite_where=text("status = 'running'"),
            postgresql_where=text("status = 'running'"),
        ),
        Index("ix_run_workspace_started", "workspace_id", "started_at"),
    )


class NodeRun(AuditMixin, Base):
    __tablename__ = "node_run"

    id = Column(String(32), primary_key=True)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=True, index=True)
    run_id = Column(String(32), index=True)
    node_id = Column(String(24))
    node_type = Column(String(30))
    node_name = Column(String(200))
    status = Column(String(20))
    attempt = Column(Integer, default=1)
    started_at = Column(DateTime, nullable=True, index=True)
    finished_at = Column(DateTime, nullable=True)
    input_json = Column(Text, nullable=True)
    output_json = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    model = Column(String(100), nullable=True)

    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    duration_ms = Column(Integer, default=0)

    __table_args__ = (Index("ix_node_run_workspace_run", "workspace_id", "run_id"),)
