"""API dependency injection helpers."""
from __future__ import annotations

from typing import Iterator

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db.database import get_db


def get_session() -> Iterator[Session]:
    """Request-scoped SQLAlchemy session."""
    yield from get_db()
