"""0017：子工作流独立运行记录

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-06

TRIGGER-02 Phase C：
- run 增加 parent_run_id / parent_node_id，子工作流执行落独立 Run；
- 放宽 running 唯一索引：子运行（trigger='subworkflow'）允许同一工作流并发，
  手动 / API / 调试运行仍保持单实例串行。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("run", sa.Column("parent_run_id", sa.String(32), nullable=True))
    op.add_column("run", sa.Column("parent_node_id", sa.String(128), nullable=True))
    op.create_index("ix_run_parent_run_id", "run", ["parent_run_id"], unique=False)
    op.create_index("ix_run_parent_started", "run", ["parent_run_id", "started_at"], unique=False)

    bind = op.get_bind()
    dialect = bind.dialect.name
    op.drop_index("uq_run_running_per_workflow", table_name="run")

    if dialect == "sqlite":
        op.create_index(
            "uq_run_running_per_workflow",
            "run",
            ["workflow_id"],
            unique=True,
            sqlite_where=sa.text("status = 'running' AND trigger != 'subworkflow'"),
        )
    else:
        op.execute(
            "CREATE UNIQUE INDEX uq_run_running_per_workflow "
            "ON run (workflow_id) "
            "WHERE status = 'running' AND trigger != 'subworkflow'"
        )


def downgrade() -> None:
    raise NotImplementedError("0017 不可降级——子运行记录与父运行外键无法安全回退")
