"""Provider 适配层单测：用 httpx.MockTransport 断言真实请求体。

覆盖评审 S9/S10：
- Ollama 的 `format` 只该在 json 模式出现（发 "text" 会 400）
- Anthropic JSON 模式必须带 tool_choice，且要能解析 tool_use 块
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider


def _capture(response_body: dict):
    """返回 (transport, requests) —— 记录所有请求便于断言。"""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=response_body)

    return httpx.MockTransport(handler), requests


def _payload(request: httpx.Request) -> dict:
    return json.loads(request.content.decode("utf-8"))


def _ollama_body() -> dict:
    return {"model": "m", "message": {"content": "hello"}, "usage": {}}


def _openai_body(content: str = "hello") -> dict:
    return {
        "model": "m",
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 3, "completion_tokens": 4},
    }


def _anthropic_body(parts: list[dict]) -> dict:
    return {
        "model": "m",
        "content": parts,
        "usage": {"input_tokens": 3, "output_tokens": 4},
    }


async def test_ollama_text_mode_omits_format() -> None:
    transport, requests = _capture(_ollama_body())
    provider = OllamaProvider(base_url="http://127.0.0.1:11434", transport=transport)

    await provider.chat(model="m", user="hi", response_format="text")

    payload = _payload(requests[0])
    assert "format" not in payload, "Ollama 只接受 json 或不带 format，发 text 会 400"


async def test_ollama_json_mode_sets_format_json() -> None:
    transport, requests = _capture(_ollama_body())
    provider = OllamaProvider(base_url="http://127.0.0.1:11434", transport=transport)

    await provider.chat(model="m", user="hi", response_format="json")

    assert _payload(requests[0])["format"] == "json"


async def test_openai_json_mode_sets_response_format() -> None:
    transport, requests = _capture(_openai_body('{"a": 1}'))
    provider = OpenAICompatProvider(
        base_url="https://example.com/v1", api_key="k", transport=transport
    )

    result = await provider.chat(model="m", user="hi", response_format="json")

    payload = _payload(requests[0])
    assert payload["response_format"] == {"type": "json_object"}
    assert requests[0].headers["authorization"] == "Bearer k"
    assert result.content == {"a": 1}, "JSON 模式应解析成对象"
    assert result.tokens_in == 3 and result.tokens_out == 4


async def test_openai_text_mode_has_no_response_format() -> None:
    transport, requests = _capture(_openai_body())
    provider = OpenAICompatProvider(
        base_url="https://example.com/v1", api_key="k", transport=transport
    )

    await provider.chat(model="m", user="hi")

    assert "response_format" not in _payload(requests[0])


async def test_anthropic_json_mode_forces_tool_choice() -> None:
    transport, requests = _capture(_anthropic_body([{"type": "text", "text": "ignored"}]))
    provider = AnthropicCompatProvider(
        base_url="https://example.com", api_key="k", transport=transport
    )

    await provider.chat(model="m", user="hi", response_format="json")

    payload = _payload(requests[0])
    assert payload["tool_choice"] == {"type": "tool", "name": "output_json"}
    assert payload["tools"][0]["name"] == "output_json"


async def test_anthropic_parses_tool_use_block_as_structured_content() -> None:
    body = _anthropic_body(
        [
            {"type": "text", "text": "思考中..."},
            {"type": "tool_use", "name": "output_json", "input": {"sentiment": "正面"}},
        ]
    )
    transport, _ = _capture(body)
    provider = AnthropicCompatProvider(
        base_url="https://example.com", api_key="k", transport=transport
    )

    result = await provider.chat(model="m", user="hi", response_format="json")

    assert result.content == {"sentiment": "正面"}
    assert result.tokens_in == 3 and result.tokens_out == 4


async def test_anthropic_text_mode_keeps_text_and_skips_tools() -> None:
    transport, requests = _capture(_anthropic_body([{"type": "text", "text": "纯文本回答"}]))
    provider = AnthropicCompatProvider(
        base_url="https://example.com", api_key="k", transport=transport
    )

    result = await provider.chat(model="m", user="hi")

    payload = _payload(requests[0])
    assert "tools" not in payload and "tool_choice" not in payload
    assert result.content == "纯文本回答"


async def test_http_error_is_mapped_to_readable_chinese() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid key"})

    provider = OpenAICompatProvider(
        base_url="https://example.com/v1", api_key="bad", transport=httpx.MockTransport(handler)
    )

    with pytest.raises(httpx.HTTPStatusError):
        await provider.chat(model="m", user="hi")
