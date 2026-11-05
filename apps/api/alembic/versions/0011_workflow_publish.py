"""0011：工作流发布状态（published_version_id / published_at）

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-05

ASYNC-05：发布状态与 `status`（可运行性）分离，避免每次保存自动重算时
把「已发布」覆盖掉。两个字段均可空，存量数据视为未发布。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workflow", sa.Column("published_version_id", sa.String(32), nullable=True))
    op.add_column("workflow", sa.Column("published_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("workflow", "published_at")
    op.drop_column("workflow", "published_version_id")
