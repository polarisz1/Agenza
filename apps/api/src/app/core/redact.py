"""脱敏：把可能含密钥/凭据/个人信息的文本遮掉后再发给第三方模型。

GATE-04 Phase 2 的 AI 深度分析会把运行错误、节点输出等交给模型，
这些内容里可能夹带 API Key、Bearer Token、URL 凭据或邮箱。这里做**保守**脱敏：
- 只替换明显的密钥/令牌/凭据形态，不猜测业务数据；
- 不改变文本结构与长度量级，避免模型看不懂上下文；
- 统一截断，防止超长输出把 prompt 撑爆。
"""

from __future__ import annotations

import json
import re
from typing import Any

# 顺序敏感：先处理带前缀的令牌，再处理 `key=...` 这类键值对
_RULES: list[tuple[Any, str]] = []


def _rule(pattern: str, replacement: str) -> None:
    _RULES.append((re.compile(pattern, re.IGNORECASE), replacement))


# Authorization: Bearer xxx / Authorization=xxx
_rule(r"(authorization\s*[:=]\s*)(bearer\s+)?[A-Za-z0-9._\-+/=]{8,}", r"\1\2***")
# 裸 Bearer token
_rule(r"\b(bearer)\s+[A-Za-z0-9._\-+/=]{8,}", r"\1 ***")
# OpenAI / Anthropic 风格 key（允许 `sk-proj-xxx` 这类带连字符的形态）
_rule(r"\b(sk|rk|pk|ak)-[A-Za-z0-9_-]{8,}", r"\1-***")
# api_key=xxx / token: xxx / password=xxx（值里排除中英文逗号，避免吞掉后续说明）
_rule(
    r"((?:api[_-]?key|access[_-]?key|secret|token|password|passwd)\s*[:=]\s*['\"]?)"
    r"[^\s'\",;，；}]{4,}",
    r"\1***",
)
# URL 中的 user:password@
_rule(r"(://)[^/\s:@]+:[^/\s@]+@", r"\1***:***@")
# 邮箱：保留首字符与域名
_rule(r"\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})", r"\1***\2")

_DEFAULT_LIMIT = 4000


def redact_text(value: Any, limit: int = _DEFAULT_LIMIT) -> str:
    """返回脱敏并截断后的文本；`None` 返回空串。"""
    if value is None:
        return ""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    for pattern, replacement in _RULES:
        text = pattern.sub(replacement, text)
    text = text.strip()
    return text if len(text) <= limit else f"{text[:limit]}…（已截断）"
