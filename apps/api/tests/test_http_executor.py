"""HTTP 节点的响应体上限（G8）。

用假 client 模拟超大响应，确认：
- 超过上限时不再整个读进内存（只保留前 MAX_HTTP_BODY_BYTES）
- 输出里带 truncated 标记，预览可读
"""

from __future__ import annotations

import httpx

from app.core.engine.contexts import NodeContext
from app.core.engine.executors import http as http_module
from app.core.engine.executors.http import HttpExecutor
from app.core.engine.limits import MAX_HTTP_BODY_BYTES


class _FakeResponse:
    def __init__(self, content: bytes, status_code: int = 200) -> None:
        self.content = content
        self.status_code = status_code
        self.headers = {"content-type": "text/plain"}
        self.encoding = "utf-8"
        self.reason_phrase = "OK"

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300


class _FakeClient:
    def __init__(self, response: _FakeResponse) -> None:
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    async def get(self, *args, **kwargs):
        return self._response


def _ctx() -> NodeContext:
    return NodeContext(
        node={
            "id": "h",
            "type": "http",
            "name": "HTTP",
            "config": {"url": "https://example.com", "method": "GET"},
        },
        run_inputs={},
        upstream={},
    )


async def test_oversized_body_is_truncated(monkeypatch) -> None:
    big = b"x" * (MAX_HTTP_BODY_BYTES + 1024)
    monkeypatch.setattr(
        http_module.httpx, "AsyncClient", lambda **kwargs: _FakeClient(_FakeResponse(big))
    )

    result = await HttpExecutor().execute(_ctx())

    assert result.status == "success", result.error
    assert result.output["truncated"] is True
    assert result.output["body"]["truncated"] is True
    assert result.output["body"]["bytes_read"] == MAX_HTTP_BODY_BYTES


async def test_normal_json_body_is_parsed(monkeypatch) -> None:
    body = b'{"ok": true, "n": 3}'
    monkeypatch.setattr(
        http_module.httpx, "AsyncClient", lambda **kwargs: _FakeClient(_FakeResponse(body))
    )

    result = await HttpExecutor().execute(_ctx())

    assert result.output["body"] == {"ok": True, "n": 3}
    assert "truncated" not in result.output


async def test_connect_error_is_readable(monkeypatch) -> None:
    class _Boom:
        async def __aenter__(self):
            raise httpx.ConnectError("boom")

        async def __aexit__(self, *exc) -> None:
            return None

    monkeypatch.setattr(http_module.httpx, "AsyncClient", lambda **kwargs: _Boom())

    result = await HttpExecutor().execute(_ctx())

    assert result.status == "failed"
    assert "无法连接" in (result.error or "")
