"""PostgreSQL 专用迁移辅助。

DB-03：Alembic 迁移需要能在 PostgreSQL 上使用原生 UUID、JSONB 与
`CREATE INDEX CONCURRENTLY`，同时保持 SQLite（本地开发 / 桌面版）可运行。

使用约定：
- 新表主键优先用 ``uuid_type()``（PostgreSQL 原生 UUID，SQLite CHAR(32)）。
- JSON 列优先用 ``jsonb_type()``（PostgreSQL JSONB，SQLite JSON）。
- 大表索引在迁移里用 ``create_index_concurrently()``，不要在普通事务里直接
  执行 ``CREATE INDEX CONCURRENTLY``。
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


def uuid_type(*, as_uuid: bool = False) -> sa.types.TypeEngine:
    """跨数据库 UUID 类型。

    ``as_uuid=False`` 时 Python 侧仍使用字符串，兼容现有 `String(36)` 数据；
    设为 True 则读写 UUID 对象。
    """
    return sa.Uuid(as_uuid=as_uuid)


def jsonb_type() -> sa.types.TypeEngine:
    """PostgreSQL 用 JSONB，其他方言退回标准 JSON。"""
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def is_postgresql() -> bool:
    """当前迁移连接是否为 PostgreSQL。"""
    from alembic import op

    return op.get_bind().dialect.name == "postgresql"


def _quoted(name: str) -> str:
    from alembic import op

    return op.get_bind().dialect.identifier_preparer.quote(name)


def create_index_concurrently(
    name: str,
    table: str,
    columns: list[str],
    *,
    unique: bool = False,
    where: str | None = None,
) -> None:
    """创建索引；PostgreSQL 使用 CONCURRENTLY，SQLite 使用普通索引。

    PostgreSQL 下会通过 Alembic 的 ``autocommit_block`` 执行，避免长事务锁表。
    索引已存在时跳过（``IF NOT EXISTS``），保证迁移可重入。
    """
    from alembic import op

    unique_sql = "UNIQUE " if unique else ""
    column_sql = ", ".join(_quoted(column) for column in columns)
    table_sql = _quoted(table)
    index_sql = _quoted(name)
    where_sql = f" WHERE {where}" if where else ""

    if is_postgresql():
        sql = (
            f"CREATE {unique_sql}INDEX CONCURRENTLY IF NOT EXISTS "
            f"{index_sql} ON {table_sql} ({column_sql}){where_sql}"
        )
        with op.get_context().autocommit_block():
            op.execute(sql)
        return

    op.execute(
        f"CREATE {unique_sql}INDEX IF NOT EXISTS {index_sql} "
        f"ON {table_sql} ({column_sql}){where_sql}"
    )


def drop_index_concurrently(name: str) -> None:
    """删除索引；PostgreSQL 使用 DROP INDEX CONCURRENTLY。"""
    from alembic import op

    index_sql = _quoted(name)
    if is_postgresql():
        with op.get_context().autocommit_block():
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {index_sql}")
        return

    op.execute(f"DROP INDEX IF EXISTS {index_sql}")
