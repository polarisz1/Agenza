"""SaaS 认证依赖的回归测试。

背景：`_extract_bearer` 曾被写成 `async def`，但调用方都是同步地
`token = _extract_bearer(request)`，拿到 coroutine 对象后传给 jose 的
jwt.decode 会抛 AttributeError，导致登录成功后 /api/v1/auth/me 与
/api/v1/workspaces 全部 500。这里锁死"它必须是同步函数且返回字符串"。
"""

from __future__ import annotations

import inspect

import pytest
from starlette.requests import Request

from app.modules.auth.dependencies import _extract_bearer


def _make_request(headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw})


def test_extract_bearer_is_sync_and_returns_token():
    assert not inspect.iscoroutinefunction(_extract_bearer), (
        "_extract_bearer 必须是同步函数：调用方没有 await"
    )

    token = _extract_bearer(_make_request({"Authorization": "Bearer abc.def.ghi"}))
    assert isinstance(token, str)
    assert token == "abc.def.ghi"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Basic xyz"}])
def test_extract_bearer_returns_none_without_bearer(headers):
    assert _extract_bearer(_make_request(headers)) is None
