"""Anthropic-compatible provider."""

from __future__ import annotations

import httpx

from app.core.net import trust_env_for
from app.core.providers.base import ChatResult, ProviderAdapter, ResponseFormat


class AnthropicCompatProvider(ProviderAdapter):
    kind = "anthropic-compat"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        default_model: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model or "claude-3.5-sonnet"
        self._transport = transport

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
        payload = {
            "model": model or self.default_model,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if response_format == "json":
            # 只声明 tool 不够：必须用 tool_choice 强制调用，否则模型往往仍返回纯文本；
            # 返回体里对应的也是 tool_use 块（下面统一解析）。
            payload["tools"] = [
                {
                    "name": "output_json",
                    "description": "以 JSON 对象返回最终结果",
                    "input_schema": {"type": "object"},
                }
            ]
            payload["tool_choice"] = {"type": "tool", "name": "output_json"}

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient(
            timeout=120,
            trust_env=trust_env_for(self.base_url),
            transport=self._transport,
        ) as client:
            resp = await client.post(f"{self.base_url}/v1/messages", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        # 文本块拼接；若模型走了 tool_use，则直接把 input 当结构化结果
        content: str | dict = ""
        tool_payload: dict | None = None
        for part in data.get("content", []):
            if part.get("type") == "text":
                content = f"{content}{part.get('text', '')}" if content else part.get("text", "")
            elif part.get("type") == "tool_use" and isinstance(part.get("input"), dict):
                tool_payload = part["input"]

        if response_format == "json" and tool_payload is not None:
            content = tool_payload

        usage = data.get("usage", {})
        return ChatResult(
            content=content,
            model=data.get("model", payload["model"]),
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
        )
