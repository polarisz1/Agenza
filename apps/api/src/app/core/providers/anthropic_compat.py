"""Anthropic-compatible provider."""

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

# Anthropic 没有公开的 /models 列表接口：给一组稳定别名，前端仍允许手动输入
DEFAULT_MODELS = ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"]


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
            # 部分"Anthropic 兼容"实现不支持 tool_choice（如 DeepSeek 的 thinking 模式），
            # 这时退化为"提示词要求 JSON + 解析文本"，而不是让整个抽取节点失败。
            if (
                response_format == "json"
                and resp.status_code in (400, 422)
                and "tool" in resp.text.lower()
            ):
                payload.pop("tools", None)
                payload.pop("tool_choice", None)
                payload["system"] = (
                    f"{system}\n\n只输出一个 JSON 对象，不要 markdown 代码块或解释。"
                ).strip()
                resp = await client.post(
                    f"{self.base_url}/v1/messages", json=payload, headers=headers
                )
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
        elif response_format == "json" and isinstance(content, str):
            # 上面的 tool_choice 降级路径：模型返回的是文本 JSON，尽量解析成对象
            text = content.strip()
            if text.startswith("```"):
                text = text.strip("`")
                if text.lower().startswith("json"):
                    text = text[4:].strip()
                if text.endswith("```"):
                    text = text[:-3].strip()
            with contextlib.suppress(Exception):
                content = json.loads(text)

        usage = data.get("usage", {})
        return ChatResult(
            content=content,
            model=data.get("model", payload["model"]),
            tokens_in=usage.get("input_tokens", 0),
            tokens_out=usage.get("output_tokens", 0),
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
        """Anthropic SSE（text_delta）。

        JSON 模式要走 tool_use，流式解析 tool input 的复杂度高且容易半截；
        这里直接降级为非流式，保证结构化抽取的正确性优先。
        """
        if response_format == "json":
            return await super().stream(
                model=model,
                system=system,
                user=user,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=response_format,
                on_delta=on_delta,
            )

        payload = {
            "model": model or self.default_model,
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        chunks: list[str] = []
        resolved_model = payload["model"]
        tokens_in = 0
        tokens_out = 0
        async with (
            httpx.AsyncClient(
                timeout=120,
                trust_env=trust_env_for(self.base_url),
                transport=self._transport,
            ) as client,
            client.stream(
                "POST", f"{self.base_url}/v1/messages", json=payload, headers=headers
            ) as resp,
        ):
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                try:
                    data = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                kind = data.get("type")
                if kind == "message_start":
                    message = data.get("message", {})
                    resolved_model = message.get("model", resolved_model)
                    tokens_in = int(message.get("usage", {}).get("input_tokens") or 0)
                elif kind == "content_block_delta":
                    delta = data.get("delta", {})
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        chunks.append(delta["text"])
                        await emit_delta(on_delta, delta["text"])
                elif kind == "message_delta":
                    tokens_out = int(data.get("usage", {}).get("output_tokens") or 0)

        return ChatResult(
            content="".join(chunks),
            model=resolved_model,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )

    async def list_models(self) -> list[str]:
        return list(DEFAULT_MODELS)
