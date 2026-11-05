"""0010：app_setting 改为复合主键 (key, workspace_id)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-05

ADAPT-04 / INFRA-02 回归发现：0004 只给 app_setting 加了 workspace_id 列，
主键仍是 key 单列。模型里是 (key, workspace_id) 复合主键，SaaS 模式下
不同工作空间写同一项设置（如 language）会撞唯一约束。

本迁移：
- 把存量 NULL 的 workspace_id 回填为空字符串（桌面模式语义）；
- 主键改为 (key, workspace_id)，workspace_id 置为 NOT NULL；
- PostgreSQL 直接改约束，SQLite 走整表重建。
"""

from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    op.execute("UPDATE app_setting SET workspace_id = '' WHERE workspace_id IS NULL")

    if _is_postgres():
        op.execute("ALTER TABLE app_setting ALTER COLUMN workspace_id SET NOT NULL")
        op.drop_constraint("app_setting_pkey", "app_setting", type_="primary")
        op.create_primary_key("app_setting_pkey", "app_setting", ["key", "workspace_id"])
        return

    # SQLite 无法就地修改主键，整表重建
    op.execute(
        "CREATE TABLE app_setting_new ("
        " key VARCHAR(100) NOT NULL,"
        " workspace_id VARCHAR(36) NOT NULL,"
        " value_json TEXT,"
        " updated_at DATETIME,"
        " created_by VARCHAR(36),"
        " updated_by VARCHAR(36),"
        " deleted_at DATETIME,"
        " PRIMARY KEY (key, workspace_id),"
        " FOREIGN KEY(workspace_id) REFERENCES workspace (id)"
        ")"
    )
    op.execute(
        "INSERT INTO app_setting_new"
        " (key, workspace_id, value_json, updated_at, created_by, updated_by, deleted_at)"
        " SELECT key, COALESCE(workspace_id, ''), value_json, updated_at,"
        " created_by, updated_by, deleted_at FROM app_setting"
    )
    op.execute("DROP TABLE app_setting")
    op.execute("ALTER TABLE app_setting_new RENAME TO app_setting")


def downgrade() -> None:
    # 回退到全局单主键：只保留桌面/全局那行，工作空间级设置会被丢弃
    op.execute("DELETE FROM app_setting WHERE COALESCE(workspace_id, '') <> ''")

    if _is_postgres():
        op.drop_constraint("app_setting_pkey", "app_setting", type_="primary")
        op.create_primary_key("app_setting_pkey", "app_setting", ["key"])
        op.execute("ALTER TABLE app_setting ALTER COLUMN workspace_id DROP NOT NULL")
        op.execute("UPDATE app_setting SET workspace_id = NULL")
        return

    op.execute(
        "CREATE TABLE app_setting_new ("
        " key VARCHAR(100) NOT NULL,"
        " workspace_id VARCHAR(36),"
        " value_json TEXT,"
        " updated_at DATETIME,"
        " created_by VARCHAR(36),"
        " updated_by VARCHAR(36),"
        " deleted_at DATETIME,"
        " PRIMARY KEY (key),"
        " FOREIGN KEY(workspace_id) REFERENCES workspace (id)"
        ")"
    )
    op.execute(
        "INSERT INTO app_setting_new"
        " (key, workspace_id, value_json, updated_at, created_by, updated_by, deleted_at)"
        " SELECT key, NULL, value_json, updated_at,"
        " created_by, updated_by, deleted_at FROM app_setting"
    )
    op.execute("DROP TABLE app_setting")
    op.execute("ALTER TABLE app_setting_new RENAME TO app_setting")
