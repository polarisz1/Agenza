"""Settings repository - 应用键值配置的持久化操作。

SaaS 多租户：设置按 workspace 隔离；桌面模式 workspace_id 为 None（全局）。
AppSetting 复合主键 (key, workspace_id)，因此用 query 而非 session.get。
"""

from __future__ import annotations

from app.core.tenancy import get_workspace_id
from app.modules.settings.models import AppSetting
from sqlalchemy.orm import Session


def _ws_id() -> str | None:
    ws = get_workspace_id()
    return str(ws) if ws is not None else None


class SettingsRepository:
    @staticmethod
    def get(session: Session, key: str) -> AppSetting | None:
        ws = _ws_id()
        q = session.query(AppSetting).filter(AppSetting.key == key)
        if ws is not None:
            q = q.filter(AppSetting.workspace_id == ws)
        else:
            # 桌面模式：workspace_id 为空字符串或 None
            q = q.filter((AppSetting.workspace_id == None) | (AppSetting.workspace_id == ""))  # noqa: E711
        return q.first()

    @staticmethod
    def list_all(session: Session) -> list[AppSetting]:
        ws = _ws_id()
        q = session.query(AppSetting)
        if ws is not None:
            q = q.filter(AppSetting.workspace_id == ws)
        else:
            q = q.filter((AppSetting.workspace_id == None) | (AppSetting.workspace_id == ""))  # noqa: E711
        return q.all()

    @staticmethod
    def upsert(session: Session, key: str, value_json: str) -> None:
        ws = _ws_id()
        row = SettingsRepository.get(session, key)
        if row is None:
            session.add(AppSetting(key=key, workspace_id=ws or "", value_json=value_json))
        else:
            row.value_json = value_json
        session.flush()
