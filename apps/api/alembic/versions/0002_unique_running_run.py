"""0002：同一工作流只允许一个 running 的运行（评审 G6）

"先查再插"挡不住并发的双击运行，改用 SQLite 的部分唯一索引让数据库兜底：
只对 `status = 'running'` 的行生效，运行结束后索引自然放行。

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_run_running_per_workflow",
        "run",
        ["workflow_id"],
        unique=True,
        sqlite_where=sa.text("status = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("uq_run_running_per_workflow", table_name="run")
