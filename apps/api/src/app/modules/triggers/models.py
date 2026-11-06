"""TRIGGER-01：外部触发记录（幂等键 → 运行）。

只保存幂等映射，不存请求体；业务数据仍落在 `run` / `node_run`。
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint

from app.core.time import utcnow
from app.db.audit import AuditMixin
from app.db.database import Base


def _request_id() -> str:
    return f"trq_{uuid4().hex[:12]}"


def _trigger_id() -> str:
    return f"trg_{uuid4().hex[:12]}"


class WorkflowTrigger(AuditMixin, Base):
    """TRIGGER-01 Phase C：工作流级 Webhook 触发器。

    secret 用 Fernet 加密存储（HMAC 需要原始密钥，不能只存哈希）；
    明文只在创建/轮换时返回一次。
    """

    __tablename__ = "workflow_trigger"

    id = Column(String(32), primary_key=True, default=_trigger_id)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=False, index=True)
    workflow_id = Column(String(32), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    kind = Column(String(20), default="webhook")
    secret_enc = Column(Text, nullable=False)
    # JSON: {"workflow_input_key": "$.payload.path"}；为空表示请求体本身就是 inputs
    input_mapping = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    last_triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        Index("ix_workflow_trigger_workspace_workflow", "workspace_id", "workflow_id"),
    )


class TriggerRequest(AuditMixin, Base):
    __tablename__ = "trigger_request"

    id = Column(String(32), primary_key=True, default=_request_id)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=False, index=True)
    workflow_id = Column(String(32), nullable=False, index=True)
    # 调用方传入的 Idempotency-Key；为空表示不做幂等
    idempotency_key = Column(String(200), nullable=True)
    run_id = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "workflow_id",
            "idempotency_key",
            name="uq_trigger_request_idempotency",
        ),
        Index("ix_trigger_request_workspace_workflow", "workspace_id", "workflow_id"),
    )
