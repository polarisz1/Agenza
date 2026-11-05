"""Provider base adapter."""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

import httpx

ChatRole = Literal["system", "user", "assistant"]
ResponseFormat = Literal["text", "json"]

# 增量回调：同步函数或协程都可以（引擎传 async，测试传普通函数）
DeltaCallback = Callable[[str], Any]


async def emit_delta(on_delta: DeltaCallback | None, text: str | None) -> None:
    """把增量文本交给回调；空片段直接忽略。"""
    if on_delta is None or not text:
        return
    result = on_delta(text)
    if inspect.isawaitable(result):
        await result


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

    async def stream(
        self,
        *,
        model: str | None,
        system: str = "",
        user: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2048,
        response_format: ResponseFormat = "text",
        on_delta: DeltaCallback | None = None,
    ) -> ChatResult:
        """流式对话；默认降级为一次性 chat 并整段回调。

        适配器应尽量覆盖此方法（OpenAI/Ollama/Anthropic 都支持 SSE/NDJSON）；
        不支持流式的场景（如 Anthropic 的 JSON 模式）保持这个降级实现即可。
        """
        result = await self.chat(
            model=model,
            system=system,
            user=user,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format,
        )
        if isinstance(result.content, str):
            await emit_delta(on_delta, result.content)
        return result

    async def list_models(self) -> list[str]:
        """可用模型列表；默认空（前端仍允许手动输入）。"""
        return []


class ProviderError(RuntimeError):
    """服务商不可用（配置/密钥问题），错误信息直接展示给用户。"""


class UnusableProvider(ProviderAdapter):
    """占位适配器：让"服务商存在但不可用"有明确报错，而不是静默变成空密钥。"""

    def __init__(self, reason: str) -> None:
        self.reason = reason

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
        raise ProviderError(self.reason)


class ProviderRegistry:
    """In-memory provider instances, keyed by provider db id."""

    def __init__(self) -> None:
        self._providers: dict[str, ProviderAdapter] = {}

    def register(self, provider_id: str, adapter: ProviderAdapter) -> None:
        self._providers[provider_id] = adapter

    def get(self, provider_id: str) -> ProviderAdapter | None:
        return self._providers.get(provider_id)

    def usable_ids(self) -> set[str]:
        """可用于自动路由的服务商 id（排除密钥解不开的占位实现）。"""
        return {
            provider_id
            for provider_id, adapter in self._providers.items()
            if not isinstance(adapter, UnusableProvider)
        }

    def clear(self) -> None:
        self._providers.clear()
