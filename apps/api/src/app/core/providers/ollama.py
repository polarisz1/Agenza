"""Local Ollama provider - localhost:11434."""

from __future__ import annotations

import contextlib
import json

import httpx

from app.core.net import trust_env_for
from app.core.providers.base import (
    ChatResult,
    DeltaCallback,
    ProviderAdapter,
    ResponseFormat,
    emit_delta,
)


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
        """Ollama NDJSON 流：每行一个 JSON，`done=true` 时带 token 统计。"""
        payload = {
            "model": model or self.default_model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": True,
            "options": {"temperature": temperature, "num_predict": max_tokens},
        }
        if response_format == "json":
            payload["format"] = "json"

        chunks: list[str] = []
        resolved_model = payload["model"]
        tokens_in = 0
        tokens_out = 0
        async with (
            httpx.AsyncClient(
                timeout=600,
                trust_env=trust_env_for(self.base_url),
                transport=self._transport,
            ) as client,
            client.stream("POST", f"{self.base_url}/api/chat", json=payload) as resp,
        ):
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                resolved_model = data.get("model", resolved_model)
                piece = data.get("message", {}).get("content")
                if piece:
                    chunks.append(piece)
                    await emit_delta(on_delta, piece)
                if data.get("done"):
                    tokens_in = int(data.get("prompt_eval_count") or 0)
                    tokens_out = int(data.get("eval_count") or 0)

        content: str | dict = "".join(chunks)
        if response_format == "json":
            with contextlib.suppress(Exception):
                content = json.loads(content)

        return ChatResult(
            content=content,
            model=resolved_model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )

    async def list_models(self) -> list[str]:
        async with httpx.AsyncClient(
            timeout=20,
            trust_env=trust_env_for(self.base_url),
            transport=self._transport,
        ) as client:
            resp = await client.get(f"{self.base_url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
        return [str(item["name"]) for item in data.get("models", []) if item.get("name")]
