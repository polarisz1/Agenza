"""AI Gateway 模型：预算配置 + 路由策略（GATE-01）。"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String

from app.core.time import utcnow
from app.db.audit import AuditMixin
from app.db.database import Base


def _gw_id() -> str:
    return f"gw_{uuid4().hex[:12]}"


class GatewayConfig(AuditMixin, Base):
    """工作空间级预算配置（每个 workspace 最多一条，桌面模式 workspace_id 为 NULL）。"""

    __tablename__ = "gateway_config"

    id = Column(String(32), primary_key=True, default=_gw_id)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=True, index=True)
    enabled = Column(Boolean, default=True)
    # 0 表示不限制
    monthly_budget_usd = Column(Float, default=0.0)
    alert_threshold_pct = Column(Integer, default=80)
    hard_stop = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_gateway_config_workspace", "workspace_id"),)


class GatewayRoute(AuditMixin, Base):
    """按任务类型配置首选/备选模型与单价（单价单位：USD / 1K tokens）。"""

    __tablename__ = "gateway_route"

    id = Column(String(32), primary_key=True, default=_gw_id)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=True, index=True)
    task_type = Column(String(30), nullable=False)  # default | extract | long_text | creative
    label = Column(String(100), nullable=True)
    primary_provider_id = Column(String(32), nullable=True)
    primary_model = Column(String(200), nullable=False)
    fallback_provider_id = Column(String(32), nullable=True)
    fallback_model = Column(String(200), nullable=True)
    input_price_per_1k = Column(Float, default=0.0)
    output_price_per_1k = Column(Float, default=0.0)
    fallback_input_price_per_1k = Column(Float, default=0.0)
    fallback_output_price_per_1k = Column(Float, default=0.0)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (Index("ix_gateway_route_workspace_task", "workspace_id", "task_type"),)
