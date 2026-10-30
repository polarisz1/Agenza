"""App setting model."""
from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text

from app.db.database import Base


class AppSetting(Base):
    __tablename__ = "app_setting"

    key = Column(String(100), primary_key=True)
    value_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
