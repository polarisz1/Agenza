"""0003：工作流版本快照 + 运行关联版本（F5）

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workflow_version",
        sa.Column("id", sa.String(length=24), nullable=False),
        sa.Column("workflow_id", sa.String(length=12), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("summary", sa.String(length=200), nullable=True),
        sa.Column("graph_json", sa.Text(), nullable=False),
        sa.Column("viewport_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workflow_version_workflow_id"),
        "workflow_version",
        ["workflow_id"],
        unique=False,
    )
    op.create_index(
        "uq_workflow_version_seq",
        "workflow_version",
        ["workflow_id", "seq"],
        unique=True,
    )

    with op.batch_alter_table("run") as batch:
        batch.add_column(sa.Column("version_id", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("version_seq", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("run") as batch:
        batch.drop_column("version_seq")
        batch.drop_column("version_id")

    op.drop_index("uq_workflow_version_seq", table_name="workflow_version")
    op.drop_index(op.f("ix_workflow_version_workflow_id"), table_name="workflow_version")
    op.drop_table("workflow_version")
