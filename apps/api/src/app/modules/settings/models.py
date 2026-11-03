"""App setting model."""

from app.core.time import utcnow
from app.db.database import Base
from sqlalchemy import Column, DateTime, ForeignKey, String, Text


class AppSetting(Base):
    """应用级设置（全局 + 工作空间级别通用）。"""

    __tablename__ = "app_setting"

    # (key, workspace_id) 联合主键——桌面版 workspace_id 为空字符串
    key = Column(String(100), primary_key=True)
    workspace_id = Column(String(36), ForeignKey("workspace.id"), nullable=True, primary_key=True)
    value_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
