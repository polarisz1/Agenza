"""节点输出的大小上限（评审 G8）。

节点输出会原样写进 `node_run.output_json`，HTTP 节点还会把整个响应体塞进输出。
一次下载大文件就能把 SQLite 写爆、把 SSE 撑到卡死，所以：
- 入库前按字节截断，**截断结果仍是合法 JSON**（否则读取端 `json.loads` 会崩）
- HTTP 响应体在读取阶段就有上限，避免先把几百 MB 读进内存再判断
"""

from __future__ import annotations

import json
from typing import Any

# 单个节点输出入库上限（1MB）。正常的工作流输出远小于这个量级。
MAX_STORED_OUTPUT_BYTES = 1024 * 1024
# HTTP 响应体读取上限（2MB）：超过就停止读取并标记截断
MAX_HTTP_BODY_BYTES = 2 * 1024 * 1024
# 截断时保留的预览长度（字符）
_PREVIEW_CHARS = 2000


def truncation_marker(original_bytes: int, text: str) -> dict[str, Any]:
    """截断后的占位结构：保留可读预览 + 原始大小，便于用户判断发生了什么。"""
    return {
        "__truncated__": True,
        "original_bytes": original_bytes,
        "preview": text[:_PREVIEW_CHARS],
        "hint": "输出过大，仅保存预览；完整内容未入库",
    }


def clamp_serialized(payload: str, limit: int = MAX_STORED_OUTPUT_BYTES) -> str:
    """把序列化后的输出压到 `limit` 字节以内，返回**合法 JSON** 字符串。"""
    size = len(payload.encode("utf-8"))
    if size <= limit:
        return payload
    marker = truncation_marker(size, payload)
    return json.dumps(marker, ensure_ascii=False)


def clamp_value(value: Any, limit: int = MAX_STORED_OUTPUT_BYTES) -> Any:
    """对尚未序列化的值做同样的限制（用于事件/接口返回值）。"""
    try:
        payload = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        payload = str(value)
    if len(payload.encode("utf-8")) <= limit:
        return value
    return truncation_marker(len(payload.encode("utf-8")), payload)
