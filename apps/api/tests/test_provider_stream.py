"""F3 流式适配层：OpenAI SSE / Ollama NDJSON / Anthropic SSE + 模型列表。"""

from __future__ import annotations

import json

import httpx

from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider


def _openai_stream() -> bytes:
    chunks = [
        {"model": "gpt-test", "choices": [{"delta": {"content": "你好"}}]},
        {"model": "gpt-test", "choices": [{"delta": {"content": "，世界"}}]},
        {
            "model": "gpt-test",
            "choices": [{"delta": {}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3},
        },
    ]
    lines = [f"data: {json.dumps(chunk, ensure_ascii=False)}" for chunk in chunks]
    lines.append("data: [DONE]")
    return ("\n\n".join(lines) + "\n\n").encode("utf-8")


def _ollama_stream() -> bytes:
    lines = [
        {"model": "qwen", "message": {"content": "你"}},
        {"model": "qwen", "message": {"content": "好"}},
        {
            "model": "qwen",
            "message": {"content": ""},
            "done": True,
            "prompt_eval_count": 4,
            "eval_count": 2,
        },
    ]
    return ("\n".join(json.dumps(line, ensure_ascii=False) for line in lines) + "\n").encode()


def _anthropic_stream() -> bytes:
    events = [
        {
            "type": "message_start",
            "message": {"model": "claude-test", "usage": {"input_tokens": 7}},
        },
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": " world"}},
        {"type": "message_delta", "usage": {"output_tokens": 4}},
        {"type": "message_stop"},
    ]
    lines = [f"data: {json.dumps(event, ensure_ascii=False)}" for event in events]
    return ("\n\n".join(lines) + "\n\n").encode()


def test_openai_stream_collects_chunks_and_usage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        body = json.loads(request.content)
        assert body["stream"] is True
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=_openai_stream()
        )

    provider = OpenAICompatProvider(
        base_url="https://example.com/v1",
        api_key="sk-test",
        default_model="gpt-test",
        transport=httpx.MockTransport(handler),
    )
    deltas: list[str] = []
    result = _run(provider.stream(model=None, user="hi", on_delta=deltas.append))

    assert deltas == ["你好", "，世界"]
    assert result.content == "你好，世界"
    assert result.model == "gpt-test"
    assert (result.tokens_in, result.tokens_out) == (5, 3)


def test_ollama_stream_reads_ndjson_and_tokens() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/api/chat")
        body = json.loads(request.content)
        assert body["stream"] is True
        return httpx.Response(200, content=_ollama_stream())

    provider = OllamaProvider(
        base_url="http://localhost:11434",
        default_model="qwen",
        transport=httpx.MockTransport(handler),
    )
    deltas: list[str] = []
    result = _run(provider.stream(model=None, on_delta=deltas.append))

    assert "".join(deltas) == "你好"
    assert result.content == "你好"
    assert (result.tokens_in, result.tokens_out) == (4, 2)


def test_anthropic_stream_parses_text_delta_and_usage() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/v1/messages")
        body = json.loads(request.content)
        assert body["stream"] is True
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=_anthropic_stream()
        )

    provider = AnthropicCompatProvider(
        base_url="https://example.com",
        api_key="sk-ant",
        default_model="claude-test",
        transport=httpx.MockTransport(handler),
    )
    deltas: list[str] = []
    result = _run(provider.stream(model=None, on_delta=deltas.append))

    assert "".join(deltas) == "Hello world"
    assert result.content == "Hello world"
    assert result.model == "claude-test"
    assert (result.tokens_in, result.tokens_out) == (7, 4)


def test_anthropic_json_mode_falls_back_to_non_stream_chat(monkeypatch) -> None:
    provider = AnthropicCompatProvider(base_url="https://example.com", api_key="k")

    async def fake_chat(**kwargs):
        from app.core.providers.base import ChatResult

        return ChatResult(content={"a": 1}, model="claude-test")

    monkeypatch.setattr(provider, "chat", fake_chat)
    deltas: list[str] = []
    result = _run(provider.stream(model=None, response_format="json", on_delta=deltas.append))

    assert result.content == {"a": 1}
    # 结构化结果不逐字流式，避免半截 JSON
    assert deltas == []


def test_list_models_openai_and_ollama() -> None:
    def openai_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/models")
        return httpx.Response(200, json={"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]})

    openai = OpenAICompatProvider(
        base_url="https://example.com/v1",
        api_key="k",
        transport=httpx.MockTransport(openai_handler),
    )
    assert _run(openai.list_models()) == ["gpt-4o", "gpt-4o-mini"]

    def ollama_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/api/tags")
        return httpx.Response(200, json={"models": [{"name": "qwen2.5:7b"}]})

    ollama = OllamaProvider(
        base_url="http://localhost:11434",
        transport=httpx.MockTransport(ollama_handler),
    )
    assert _run(ollama.list_models()) == ["qwen2.5:7b"]


def _run(coro):
    import asyncio

    return asyncio.run(coro)
