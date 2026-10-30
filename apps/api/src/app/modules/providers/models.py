"""Provider module."""
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from app.db.database import Base


class Provider(Base):
    __tablename__ = "provider"

    id = Column(String(12), primary_key=True)
    kind = Column(String(30), index=True)       # openai-compat | ollama | anthropic-compat
    name = Column(String(200))
    base_url = Column(String(500))
    api_key_enc = Column(Text, nullable=True)
    default_model = Column(String(200), nullable=True)
    extra_json = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, nullable=True)
