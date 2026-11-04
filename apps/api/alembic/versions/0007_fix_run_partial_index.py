"""0007：run 表唯一索引改为 PostgreSQL partial index

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-04

0001 baseline 迁移只写了 `sqlite_where`，PostgreSQL 上被建成了
不带 WHERE 的普通 UNIQUE(workflow_id)，导致同一工作流无法有两条
run 记录（不管 status 是什么）。本迁移改为 partial index：
WHERE status = 'running'，与 SQLite 语义一致。
"""

from __future__ import annotations

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "sqlite":
        # SQLite 部分唯一索引在 0001 就按 sqlite_where 建对了
        return

    op.drop_index("uq_run_running_per_workflow", table_name="run")
    op.execute(
        "CREATE UNIQUE INDEX uq_run_running_per_workflow "
        "ON run (workflow_id) WHERE status = 'running'"
    )


def downgrade() -> None:
    raise NotImplementedError("0007 不可降级")
