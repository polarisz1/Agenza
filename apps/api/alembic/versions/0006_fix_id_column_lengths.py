"""0006：修复 id 列长度 —— SQLite 宽松，PostgreSQL 严格校验

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-04

历史迁移把主键/外键列设为 VARCHAR(12)/VARCHAR(16)，但 service 层生成的
id 格式是 `wf_` + 10 位 hex（13 字符），SQLite 不校验所以一直没报错，
PostgreSQL 严格拒绝超长值。本迁移统一加宽到 VARCHAR(32)。

SQLite 分支：跳过。SQLite 对 VARCHAR 长度不强制，且 `ALTER COLUMN ... TYPE`
不是 SQLite 支持的语法。
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


# (table, column, old_length, new_length)
_COLUMNS: list[tuple[str, str, int, int]] = [
    ("workflow", "id", 12, 32),
    ("workflow_version", "workflow_id", 12, 32),
    ("run", "id", 12, 32),
    ("run", "workflow_id", 12, 32),
    ("node_run", "run_id", 12, 32),
    ("node_run", "id", 16, 32),
    ("provider", "id", 12, 32),
]


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "sqlite":
        # SQLite 不强制 VARCHAR 长度，也不支持 ALTER COLUMN ... TYPE
        # 此处留空；stamp 0006 让版本号对齐即可
        return

    for table, col, old_len, new_len in _COLUMNS:
        op.alter_column(
            table,
            col,
            existing_type=sa.VARCHAR(length=old_len),
            type_=sa.VARCHAR(length=new_len),
            postgresql_using=f"{col}::varchar",
        )


def downgrade() -> None:
    raise NotImplementedError(
        "0006 不可降级——PostgreSQL 上 VARCHAR(12) 无法承载 `wf_xxxxxxxxxx`"
    )
