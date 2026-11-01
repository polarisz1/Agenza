"""Settings repository - 应用键值配置的持久化操作。

此前 settings 模块没有 repository，路由里直接写 SQL（评审 G2）。
跨 feature 的"清空运行记录"不放在这里——那属于 runs 模块，走 RunService。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.modules.settings.models import AppSetting


class SettingsRepository:
    @staticmethod
    def get(session: Session, key: str) -> AppSetting | None:
        return session.get(AppSetting, key)

    @staticmethod
    def list_all(session: Session) -> list[AppSetting]:
        return session.query(AppSetting).all()

    @staticmethod
    def upsert(session: Session, key: str, value_json: str) -> None:
        row = session.get(AppSetting, key)
        if row is None:
            session.add(AppSetting(key=key, value_json=value_json))
        else:
            row.value_json = value_json
        session.flush()
