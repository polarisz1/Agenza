"""时间工具：统一 naive UTC。

库里存的一直是"无时区的 UTC"，前端负责转本地时间。Python 3.12 起
`datetime.utcnow()` 已弃用，这里收口成 `utcnow()`，语义保持不变
（避免引入带时区的时间导致既有数据与新数据混排）。
"""

from __future__ import annotations

from datetime import UTC, datetime


def utcnow() -> datetime:
    """当前 UTC 时间（naive，与既有 SQLite 数据保持一致）。"""
    return datetime.now(UTC).replace(tzinfo=None)
