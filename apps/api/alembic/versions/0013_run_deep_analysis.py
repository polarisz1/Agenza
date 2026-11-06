"""0013：AI 深度分析结果缓存

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-06

GATE-04 Phase 2：按需调用模型做深度根因分析，结果按 run 持久化兼作缓存，
避免重复点击产生重复费用。tokens 字段同时供 Gateway 预算统计使用。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "run_deep_analysis",
        sa.Column("id", sa.String(32), primary_key=True, nullable=False),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspace.id"), nullable=True),
        sa.Column("run_id", sa.String(32), nullable=False),
        sa.Column("provider_id", sa.String(32), nullable=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("run_id", name="uq_run_deep_analysis_run"),
    )
    op.create_index("ix_run_deep_analysis_run_id", "run_deep_analysis", ["run_id"])
    op.create_index("ix_run_deep_analysis_workspace_id", "run_deep_analysis", ["workspace_id"])
    op.create_index(
        "ix_run_deep_analysis_workspace_run",
        "run_deep_analysis",
        ["workspace_id", "run_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_run_deep_analysis_workspace_run", table_name="run_deep_analysis")
    op.drop_index("ix_run_deep_analysis_workspace_id", table_name="run_deep_analysis")
    op.drop_index("ix_run_deep_analysis_run_id", table_name="run_deep_analysis")
    op.drop_table("run_deep_analysis")
