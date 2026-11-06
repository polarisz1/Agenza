"""0014：外部 API Key 查找与 HTTP 触发幂等

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-06

TRIGGER-01 Phase A/B：
- api_key.key_prefix 扩到 40 并加唯一索引，支持 `af_<key_id>_<secret>` 定位；
- 新增 trigger_request：Idempotency-Key → run_id 的幂等映射。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("api_key") as batch:
        batch.alter_column(
            "key_prefix",
            existing_type=sa.String(12),
            type_=sa.String(40),
            nullable=False,
        )
    op.create_index("ix_api_key_key_prefix", "api_key", ["key_prefix"], unique=True)

    op.create_table(
        "trigger_request",
        sa.Column("id", sa.String(32), primary_key=True, nullable=False),
        sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspace.id"), nullable=False),
        sa.Column("workflow_id", sa.String(32), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=True),
        sa.Column("run_id", sa.String(32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("updated_by", sa.String(36), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "workspace_id",
            "workflow_id",
            "idempotency_key",
            name="uq_trigger_request_idempotency",
        ),
    )
    op.create_index("ix_trigger_request_workspace_id", "trigger_request", ["workspace_id"])
    op.create_index("ix_trigger_request_workflow_id", "trigger_request", ["workflow_id"])
    op.create_index(
        "ix_trigger_request_workspace_workflow",
        "trigger_request",
        ["workspace_id", "workflow_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_trigger_request_workspace_workflow", table_name="trigger_request")
    op.drop_index("ix_trigger_request_workflow_id", table_name="trigger_request")
    op.drop_index("ix_trigger_request_workspace_id", table_name="trigger_request")
    op.drop_table("trigger_request")

    op.drop_index("ix_api_key_key_prefix", table_name="api_key")
    with op.batch_alter_table("api_key") as batch:
        batch.alter_column(
            "key_prefix",
            existing_type=sa.String(40),
            type_=sa.String(12),
            nullable=False,
        )
