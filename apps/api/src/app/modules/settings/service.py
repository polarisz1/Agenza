"""Settings service."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.settings.repository import SettingsRepository
from app.modules.workflows.service import WorkflowService

DEFAULTS = {
    "auto_save": True,
    "retention_per_workflow": 200,
    "default_timeout": 120,
    "language": "zh-CN",
}


class SettingsService:
    @staticmethod
    def get_effective(session: Session, key: str):
        """取某项设置的实际值；没存过就用默认值。

        引擎侧（retention / 节点默认超时）读这里，保证设置页改了真的生效（评审 S8）。
        """
        row = SettingsRepository.get(session, key)
        if row is None or not row.value_json:
            return DEFAULTS.get(key)
        try:
            return json.loads(row.value_json)
        except Exception:
            return DEFAULTS.get(key)

    @staticmethod
    def get_all(session: Session) -> dict:
        out = {key: SettingsService.get_effective(session, key) for key in DEFAULTS}
        out["data_dir"] = settings.DATA_DIR
        out["app_version"] = settings.APP_VERSION
        return out

    @staticmethod
    def update(session: Session, data: dict) -> dict:
        for key, value in data.items():
            if key in DEFAULTS:
                SettingsRepository.upsert(session, key, json.dumps(value, ensure_ascii=False))
        session.commit()
        return SettingsService.get_all(session)

    @staticmethod
    def export_backup(session: Session) -> dict:
        """导出设置 + 工作流（不含服务商与密钥）。"""
        data = SettingsService.get_all(session)
        return {
            "app": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "exported_at": datetime.now(UTC).isoformat(),
            "settings": {key: data.get(key) for key in DEFAULTS},
            "workflows": WorkflowService.export_all(session),
        }
