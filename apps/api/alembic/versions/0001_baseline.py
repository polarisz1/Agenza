"""baseline：AgentFlow 的首个建表版本

Revision ID: 0001
Revises:
Create Date: 2026-10-30

说明：这是"从零到当前 schema"的基线。历史版本用 `Base.metadata.create_all`
建库，所以对已有的老库要先 `alembic stamp 0001` 再 upgrade（见 db/database.py）。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value_json", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_table(
        "node_run",
        sa.Column("id", sa.String(length=16), nullable=False),
        sa.Column("run_id", sa.String(length=12), nullable=True),
        sa.Column("node_id", sa.String(length=24), nullable=True),
        sa.Column("node_type", sa.String(length=30), nullable=True),
        sa.Column("node_name", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("input_json", sa.Text(), nullable=True),
        sa.Column("output_json", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("tokens_in", sa.Integer(), nullable=True),
        sa.Column("tokens_out", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_node_run_run_id"), "node_run", ["run_id"], unique=False)
    op.create_index(op.f("ix_node_run_started_at"), "node_run", ["started_at"], unique=False)
    op.create_table(
        "provider",
        sa.Column("id", sa.String(length=12), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("api_key_enc", sa.Text(), nullable=True),
        sa.Column("default_model", sa.String(length=200), nullable=True),
        sa.Column("extra_json", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_provider_kind"), "provider", ["kind"], unique=False)
    op.create_table(
        "run",
        sa.Column("id", sa.String(length=12), nullable=False),
        sa.Column("workflow_id", sa.String(length=12), nullable=True),
        sa.Column("workflow_name", sa.String(length=200), nullable=True),
        sa.Column("graph_snapshot", sa.Text(), nullable=False),
        sa.Column("inputs_json", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("trigger", sa.String(length=20), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_run_id"), "run", ["id"], unique=False)
    op.create_index(op.f("ix_run_started_at"), "run", ["started_at"], unique=False)
    op.create_index(op.f("ix_run_workflow_id"), "run", ["workflow_id"], unique=False)
    op.create_table(
        "workflow",
        sa.Column("id", sa.String(length=12), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("graph_json", sa.Text(), nullable=False),
        sa.Column("viewport_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("last_run_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workflow_id"), "workflow", ["id"], unique=False)
    op.create_index(op.f("ix_workflow_name"), "workflow", ["name"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_workflow_name"), table_name="workflow")
    op.drop_index(op.f("ix_workflow_id"), table_name="workflow")
    op.drop_table("workflow")
    op.drop_index(op.f("ix_run_workflow_id"), table_name="run")
    op.drop_index(op.f("ix_run_started_at"), table_name="run")
    op.drop_index(op.f("ix_run_id"), table_name="run")
    op.drop_table("run")
    op.drop_index(op.f("ix_provider_kind"), table_name="provider")
    op.drop_table("provider")
    op.drop_index(op.f("ix_node_run_started_at"), table_name="node_run")
    op.drop_index(op.f("ix_node_run_run_id"), table_name="node_run")
    op.drop_table("node_run")
    op.drop_table("app_setting")
