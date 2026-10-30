"""Provider base adapter."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import httpx


ChatRole = Literal["system", "user", "assistant"]
ResponseFormat = Literal["text", "json"]


def describe_http_error(exc: httpx.HTTPStatusError) -> str:
    """把 provider 返回的 HTTP 错误转成可读中文，避免堆栈/URL 直接暴露给用户。"""
    code = exc.response.status_code
    if code in (401, 403):
        return f"鉴权失败（HTTP {code}）：请检查服务商密钥"
    if code == 404:
        return f"模型或接口不存在（HTTP {code}）：请检查模型名与服务地址"
    if code == 429:
        return f"接口限流（HTTP {code}）"
    if code >= 500:
        return f"模型服务异常（HTTP {code}）"
    body = (exc.response.text or "")[:200]
    return f"请求失败（HTTP {code}）：{body}"


@dataclass
class ChatResult:
    content: str | dict
    model: str
    tokens_in: int = 0
    tokens_out: int = 0


class ProviderAdapter:
    """Abstract base for all model providers."""

    kind: str = "base"

    async def chat(
        self,
        *,
        model: str | None,
        system: str = "",
        user: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2048,
        response_format: ResponseFormat = "text",
    ) -> ChatResult:
        raise NotImplementedError


class ProviderRegistry:
    """In-memory provider instances, keyed by provider db id."""

    def __init__(self) -> None:
        self._providers: dict[str, ProviderAdapter] = {}

    def register(self, provider_id: str, adapter: ProviderAdapter) -> None:
        self._providers[provider_id] = adapter

    def get(self, provider_id: str) -> ProviderAdapter | None:
        return self._providers.get(provider_id)

    def clear(self) -> None:
        self._providers.clear()
