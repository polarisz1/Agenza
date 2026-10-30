"""Settings service."""

from __future__ import annotations

import json
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.settings.models import AppSetting
from app.modules.workflows.service import WorkflowService

DEFAULTS = {
    "auto_save": True,
    "retention_per_workflow": 200,
    "default_timeout": 120,
    "language": "zh-CN",
}


class SettingsService:
    @staticmethod
    def _get_json(session: Session, key: str, default=None):
        row = session.get(AppSetting, key)
        if not row:
            return default
        try:
            return json.loads(row.value_json) if row.value_json else default
        except Exception:
            return default

    @staticmethod
    def _set_json(session: Session, key: str, value) -> None:
        row = session.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key)
            session.add(row)
        row.value_json = json.dumps(value, ensure_ascii=False)
        session.commit()

    @staticmethod
    def get_all(session: Session) -> dict:
        out = dict(DEFAULTS)
        for k in DEFAULTS:
            v = SettingsService._get_json(session, k, DEFAULTS[k])
            out[k] = v
        out["data_dir"] = settings.DATA_DIR
        out["app_version"] = settings.APP_VERSION
        return out

    @staticmethod
    def update(session: Session, data: dict) -> dict:
        allowed_keys = set(DEFAULTS.keys())
        for k, v in data.items():
            if k in allowed_keys:
                SettingsService._set_json(session, k, v)
        return SettingsService.get_all(session)

    @staticmethod
    def export_backup(session: Session) -> dict:
        """导出设置 + 工作流（不含服务商与密钥）。"""
        data = SettingsService.get_all(session)
        return {
            "app": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "exported_at": datetime.utcnow().isoformat() + "Z",
            "settings": {key: data.get(key) for key in DEFAULTS},
            "workflows": WorkflowService.export_all(session),
        }
