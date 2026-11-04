"""0004：SaaS 多租户 Schema — 用户/工作空间/ApiKey + workspace_id 外键

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-03

说明：
- 新增 SaaS 必需的 auth 相关表（user / workspace / workspace_member / api_key）
- 给现有业务表增加 workspace_id（nullable，桌面版保持单用户兼容）
- 所有新增列/表都是 nullable=True 或允许空字符串，不破坏桌面版现有数据
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. 新增 SaaS 鉴权表 ────────────────────────────────────

    op.create_table(
        "user",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_email"), "user", ["email"], unique=True)

    op.create_table(
        "workspace",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("owner_id", sa.String(length=36), nullable=False),
        sa.Column("plan", sa.String(length=20), nullable=True, server_default="free"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], name="fk_workspace_owner_id"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "workspace_member",
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("joined_at", sa.DateTime(), nullable=True),
        sa.Column("invited_by", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["invited_by"], ["user.id"], name="fk_wm_invited_by"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_wm_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], name="fk_wm_workspace_id"
        ),
        sa.PrimaryKeyConstraint("workspace_id", "user_id"),
    )

    op.create_table(
        "api_key",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("key_hash", sa.String(length=255), nullable=False),
        sa.Column("key_prefix", sa.String(length=12), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=True, server_default=sa.text("true")),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_apikey_user_id"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], name="fk_apikey_workspace_id"
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── 2. 现有表增加 workspace_id + created_by ──────────────────

    with op.batch_alter_table("workflow") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("created_by", sa.String(length=36), nullable=True))

    with op.batch_alter_table("workflow_version") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))

    with op.batch_alter_table("run") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("triggered_by", sa.String(length=36), nullable=True))

    with op.batch_alter_table("node_run") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))

    with op.batch_alter_table("provider") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))

    # app_setting 改为复合主键 (key, workspace_id)
    # SQLite 对 ALTER COLUMN 有限制，这里通过 batch_alter_table
    with op.batch_alter_table("app_setting") as batch:
        batch.add_column(sa.Column("workspace_id", sa.String(length=36), nullable=True))


def downgrade() -> None:
    # ── 移除现有表的 workspace 列 ────────────────────────────

    with op.batch_alter_table("app_setting") as batch:
        batch.drop_column("workspace_id")

    with op.batch_alter_table("provider") as batch:
        batch.drop_column("workspace_id")

    with op.batch_alter_table("node_run") as batch:
        batch.drop_column("workspace_id")

    with op.batch_alter_table("run") as batch:
        batch.drop_column("triggered_by")
        batch.drop_column("workspace_id")

    with op.batch_alter_table("workflow_version") as batch:
        batch.drop_column("workspace_id")

    with op.batch_alter_table("workflow") as batch:
        batch.drop_column("created_by")
        batch.drop_column("workspace_id")

    # ── 删除 SaaS auth 表 ────────────────────────────────────

    op.drop_table("api_key")
    op.drop_table("workspace_member")
    op.drop_table("workspace")
    op.drop_index(op.f("ix_user_email"), table_name="user")
    op.drop_table("user")
