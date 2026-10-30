"""App setting model."""

from sqlalchemy import Column, DateTime, String, Text

from app.core.time import utcnow
from app.db.database import Base


class AppSetting(Base):
    __tablename__ = "app_setting"

    key = Column(String(100), primary_key=True)
    value_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
