"""Local Ollama provider - localhost:11434."""

from __future__ import annotations

import contextlib
import json

import httpx

from app.core.net import trust_env_for
from app.core.providers.base import ChatResult, ProviderAdapter, ResponseFormat


class OllamaProvider(ProviderAdapter):
    kind = "ollama"

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        default_model: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model or "qwen2.5:7b"
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
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        # Ollama 的 `format` 只接受 "json" 或省略；发 "text" 会直接 400
        if response_format == "json":
            payload["format"] = "json"

        async with httpx.AsyncClient(
            timeout=600,
            trust_env=trust_env_for(self.base_url),
            transport=self._transport,
        ) as client:
            resp = await client.post(f"{self.base_url}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()

        content = data.get("message", {}).get("content", "")
        if response_format == "json" and isinstance(content, str):
            with contextlib.suppress(Exception):
                content = json.loads(content)

        return ChatResult(
            content=content,
            model=data.get("model", payload["model"]),
            tokens_in=0,
            tokens_out=0,
        )
