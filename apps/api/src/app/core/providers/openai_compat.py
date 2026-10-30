"""OpenAI-compatible provider (gpt-4o, gpt-4o-mini, deepseek-chat etc)."""

from __future__ import annotations

import contextlib
import json

import httpx

from app.core.net import trust_env_for
from app.core.providers.base import ChatResult, ProviderAdapter, ResponseFormat


class OpenAICompatProvider(ProviderAdapter):
    kind = "openai-compat"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        default_model: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model or "gpt-4o-mini"
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
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if response_format == "json":
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        url = f"{self.base_url}/chat/completions"

        async with httpx.AsyncClient(
            timeout=120,
            trust_env=trust_env_for(self.base_url),
            transport=self._transport,
        ) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        message = data["choices"][0]["message"]
        content = message.get("content", "")
        usage = data.get("usage", {})

        if response_format == "json" and isinstance(content, str):
            with contextlib.suppress(Exception):
                content = json.loads(content)

        return ChatResult(
            content=content,
            model=data.get("model", payload["model"]),
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
        )
