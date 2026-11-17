"""Celery 应用配置。

SaaS 模式：使用 Redis 作为 broker + backend，RunManager 发布任务到队列。
桌面模式：CELERY_BROKER_URL 未设置时不使用 Celery，RunManager 降级为同步 in-process。
"""

from __future__ import annotations

import os

from celery import Celery

from app.core.config import settings

# 仅在配置了 broker 时启用 Celery
celery_app: Celery | None = None

broker_url = getattr(settings, "CELERY_BROKER_URL", None) or os.getenv("CELERY_BROKER_URL")

if broker_url:
    celery_app = Celery(
        "agenza",
        broker=broker_url,
        backend=broker_url,
        include=["app.modules.runs.tasks"],
    )

    celery_app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        enable_utc=True,
        task_acks_late=True,
        worker_prefetch_multiplier=1,
    )


def is_celery_enabled() -> bool:
    """是否启用 Celery 异步执行（SaaS 模式）。"""
    return celery_app is not None
