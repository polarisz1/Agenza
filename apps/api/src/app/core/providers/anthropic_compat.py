"""Anthropic-compatible provider."""

from __future__ import annotations

import httpx

from app.core.net import trust_env_for
from app.core.providers.base import ChatResult, ProviderAdapter, ResponseFormat


class AnthropicCompatProvider(ProviderAdapter):
    kind = "anthropic-compat"

    def __init__(self, base_url: str, api_key: str, default_model: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model or "claude-3.5-sonnet"

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
            payload["tools"] = [
                {
                    "name": "output_json",
                    "input_schema": {"type": "object"},
                }
            ]

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        async with httpx.AsyncClient(timeout=120, trust_env=trust_env_for(self.base_url)) as client:
            resp = await client.post(f"{self.base_url}/v1/messages", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        content_parts = data.get("content", [])
        content = ""
        for part in content_parts:
            if part.get("type") == "text":
                content += part.get("text", "")

        usage = data.get("usage", {})
        return ChatResult(
            content=content,
            model=data.get("model", payload["model"]),
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
        )
