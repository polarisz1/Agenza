"""Loguru config."""

from __future__ import annotations

import re
import sys

from loguru import logger

from app.core.config import settings

# 日志脱敏：拦截常见密钥形态（OpenAI sk- / Authorization Bearer）
_SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
)


def _redact(message: str) -> str:
    for pattern in _SECRET_PATTERNS:
        message = pattern.sub("***", message)
    return message


logger.remove()
logger.add(
    sys.stdout,
    level=settings.LOG_LEVEL,
    format="<green>{time:HH:mm:ss}</green> | "
    "<level>{level:<7}</level> | "
    "<cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
    colorize=True,
)
log = logger.patch(lambda record: record.update(message=_redact(record["message"])))
