# Alembic versions directory

## DB-03 迁移约定

- PostgreSQL 原生类型优先使用 `app.db.pg` 的助手：
  - `uuid_type()`：PostgreSQL 原生 UUID，SQLite 自动退回 CHAR(32)
  - `jsonb_type()`：PostgreSQL JSONB，SQLite 自动退回 JSON
- 大表索引使用 `create_index_concurrently()` / `drop_index_concurrently()`：
  - PostgreSQL 自动包在 Alembic `autocommit_block` 中执行 `CREATE INDEX CONCURRENTLY`
  - SQLite 自动退回普通 `CREATE INDEX IF NOT EXISTS`
- 索引命名统一为 `ix_<table>_<cols>`，并在模型里声明同名 `Index`，避免 autogenerate 漂移。
- 迁移文件不要直接执行 `CREATE INDEX CONCURRENTLY`，否则会因事务包裹失败。
