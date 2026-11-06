"""0016：加宽 node_run.node_id，支持子工作流嵌套节点路径

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-06

TRIGGER-02 Phase B：嵌套节点 id 采用 `<父节点>/<子节点>` 形式，
最大 5 层嵌套 + 节点 id 会超过 VARCHAR(24)。本迁移加宽到 VARCHAR(128)。

SQLite 分支：跳过。SQLite 对 VARCHAR 长度不强制，且不支持
`ALTER COLUMN ... TYPE`。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return

    op.alter_column(
        "node_run",
        "node_id",
        existing_type=sa.VARCHAR(length=24),
        type_=sa.VARCHAR(length=128),
        postgresql_using="node_id::varchar",
    )


def downgrade() -> None:
    raise NotImplementedError("0016 不可降级——嵌套节点路径无法回退到 VARCHAR(24)")
