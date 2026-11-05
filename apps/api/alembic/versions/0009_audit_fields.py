"""0009：业务表统一审计字段 created_by / updated_by / deleted_at

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-05

DB-05：
- workflow 已有 created_by，本次补 updated_by / deleted_at；
- 其余业务表统一补三列；
- 新增列全部 nullable，兼容 SQLite 与 PostgreSQL 存量数据；
- 迁移内做一次能推断的历史回填（创建人/触发人/Owner）。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


# table -> 需要新增的列
_COLUMNS: dict[str, list[str]] = {
    "workflow": ["updated_by", "deleted_at"],
    "workflow_version": ["created_by", "updated_by", "deleted_at"],
    "run": ["created_by", "updated_by", "deleted_at"],
    "node_run": ["created_by", "updated_by", "deleted_at"],
    "provider": ["created_by", "updated_by", "deleted_at"],
    "app_setting": ["created_by", "updated_by", "deleted_at"],
    "user": ["created_by", "updated_by", "deleted_at"],
    "workspace": ["created_by", "updated_by", "deleted_at"],
    "workspace_member": ["created_by", "updated_by", "deleted_at"],
    "api_key": ["created_by", "updated_by", "deleted_at"],
}


def upgrade() -> None:
    for table, columns in _COLUMNS.items():
        for column in columns:
            type_ = sa.DateTime() if column == "deleted_at" else sa.String(36)
            op.add_column(table, sa.Column(column, type_, nullable=True))

    # 可推断的历史回填：不猜测，只复用已有归属字段
    op.execute("UPDATE workflow SET updated_by = created_by WHERE updated_by IS NULL")
    op.execute(
        "UPDATE workspace SET created_by = owner_id, updated_by = owner_id "
        "WHERE created_by IS NULL"
    )
    op.execute(
        "UPDATE workspace_member SET created_by = invited_by, updated_by = invited_by "
        "WHERE created_by IS NULL AND invited_by IS NOT NULL"
    )
    op.execute(
        "UPDATE run SET created_by = triggered_by, updated_by = triggered_by "
        "WHERE created_by IS NULL AND triggered_by IS NOT NULL"
    )
    op.execute(
        "UPDATE api_key SET created_by = user_id, updated_by = user_id "
        "WHERE created_by IS NULL"
    )
    op.execute(
        'UPDATE "user" SET created_by = id, updated_by = id WHERE created_by IS NULL'
    )
    op.execute(
        "UPDATE workflow_version SET created_by = ("
        "  SELECT workflow.created_by FROM workflow "
        "  WHERE workflow.id = workflow_version.workflow_id"
        ") WHERE created_by IS NULL"
    )
    op.execute(
        "UPDATE node_run SET created_by = ("
        "  SELECT run.triggered_by FROM run WHERE run.id = node_run.run_id"
        ") WHERE created_by IS NULL"
    )
    op.execute(
        "UPDATE node_run SET updated_by = created_by WHERE updated_by IS NULL"
    )
    op.execute(
        "UPDATE workflow_version SET updated_by = created_by WHERE updated_by IS NULL"
    )


def downgrade() -> None:
    for table, columns in reversed(list(_COLUMNS.items())):
        for column in reversed(columns):
            op.drop_column(table, column)
