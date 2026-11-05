"""DB-05：业务表统一审计字段。

`created_by` / `updated_by` 记录操作者用户 ID；`deleted_at` 用于软删除。
审计字段故意不建外键：用户被删除或迁移后，历史审计信息仍需保留。
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, String


class AuditMixin:
    created_by = Column(String(36), nullable=True)
    updated_by = Column(String(36), nullable=True)
    deleted_at = Column(DateTime, nullable=True)
