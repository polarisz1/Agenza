"""0012：AI Gateway 预算配置与路由策略

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-05

GATE-01：
- gateway_config：每个 workspace 一条预算/告警配置；
- gateway_route：按任务类型配置首选/备选模型与单价。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gateway_config",
        sa.Column("id", sa.String(32), primary_key=True, nullable=False),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspace.id"), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=True),
        sa.Column("monthly_budget_usd", sa.Float(), nullable=True),
        sa.Column("alert_threshold_pct", sa.Integer(), nullable=True),
        sa.Column("hard_stop", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_gateway_config_workspace", "gateway_config", ["workspace_id"])

    op.create_table(
        "gateway_route",
        sa.Column("id", sa.String(32), primary_key=True, nullable=False),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspace.id"), nullable=True),
        sa.Column("task_type", sa.String(30), nullable=False),
        sa.Column("label", sa.String(100), nullable=True),
        sa.Column("primary_provider_id", sa.String(32), nullable=True),
        sa.Column("primary_model", sa.String(200), nullable=False),
        sa.Column("fallback_provider_id", sa.String(32), nullable=True),
        sa.Column("fallback_model", sa.String(200), nullable=True),
        sa.Column("input_price_per_1k", sa.Float(), nullable=True),
        sa.Column("output_price_per_1k", sa.Float(), nullable=True),
        sa.Column("fallback_input_price_per_1k", sa.Float(), nullable=True),
        sa.Column("fallback_output_price_per_1k", sa.Float(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_gateway_route_workspace_task",
        "gateway_route",
        ["workspace_id", "task_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_gateway_route_workspace_task", table_name="gateway_route")
    op.drop_table("gateway_route")
    op.drop_index("ix_gateway_config_workspace", table_name="gateway_config")
    op.drop_table("gateway_config")
