"""0015：工作流级 Webhook 触发器

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-06

TRIGGER-01 Phase C：
- workflow_trigger：每个触发器独立 secret（Fernet 加密）、输入映射、启停状态；
- 复用 trigger_request 做 Webhook 投递幂等。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_trigger",
        sa.Column("id", sa.String(32), primary_key=True, nullable=False),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("workflow_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(20), nullable=True),
        sa.Column("secret_enc", sa.Text(), nullable=False),
        sa.Column("input_mapping", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_workflow_trigger_workspace_id", "workflow_trigger", ["workspace_id"]
    )
    op.create_index("ix_workflow_trigger_workflow_id", "workflow_trigger", ["workflow_id"])
    op.create_index(
        "ix_workflow_trigger_workspace_workflow",
        "workflow_trigger",
        ["workspace_id", "workflow_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_workflow_trigger_workspace_workflow", table_name="workflow_trigger"
    )
    op.drop_index("ix_workflow_trigger_workflow_id", table_name="workflow_trigger")
    op.drop_index("ix_workflow_trigger_workspace_id", table_name="workflow_trigger")
    op.drop_table("workflow_trigger")
