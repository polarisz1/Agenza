"""0008：PostgreSQL 多租户组合索引（CONCURRENTLY）

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-05

说明：
- 0004 只加了 workspace_id 列，没有为多租户查询补组合索引；
- PostgreSQL 使用 CREATE INDEX CONCURRENTLY，避免上线时锁表；
- SQLite 自动退回普通 CREATE INDEX，保证本地开发与桌面版可升级；
- 索引命名遵循 AGENTS 约定的 ix_<table>_<cols>。
"""

from __future__ import annotations

from app.db.pg import create_index_concurrently, drop_index_concurrently

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

INDEXES: list[tuple[str, str, list[str]]] = [
    ("ix_workflow_workspace_updated", "workflow", ["workspace_id", "updated_at"]),
    ("ix_run_workspace_started", "run", ["workspace_id", "started_at"]),
    ("ix_node_run_workspace_run", "node_run", ["workspace_id", "run_id"]),
    ("ix_workflow_version_workspace_seq", "workflow_version", ["workspace_id", "seq"]),
    ("ix_provider_workspace_enabled", "provider", ["workspace_id", "enabled"]),
    ("ix_audit_log_workspace_created", "audit_log", ["workspace_id", "created_at"]),
]


def upgrade() -> None:
    for name, table, columns in INDEXES:
        create_index_concurrently(name, table, columns)


def downgrade() -> None:
    for name, _table, _columns in reversed(INDEXES):
        drop_index_concurrently(name)
