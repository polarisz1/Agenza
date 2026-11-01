"""已保存服务商的"测试连接"（F5）。

此前前端只把表单字段发给 `/api/providers/test`，从不带已存密钥，
所以对已保存的服务商点"测试"必然鉴权失败。
这里验证 test-by-id 走的是库里的配置（含解密后的密钥）。
"""

from __future__ import annotations

from app.core.providers.base import ChatResult
from app.modules.providers import service as provider_service
from app.modules.providers.schemas import ProviderCreate
from app.modules.providers.service import ProviderService


class FakeAdapter:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def chat(self, **kwargs) -> ChatResult:
        self.calls.append(kwargs)
        return ChatResult(content="pong", model="fake-model")


class FakeSession:
    """只够 ProviderRepository.get / create / update 用的最小替身。"""

    def __init__(self) -> None:
        self.rows: dict[str, object] = {}

    def get(self, _model, key):
        return self.rows.get(key)

    def add(self, obj):
        self.rows[obj.id] = obj

    def flush(self):
        # 仓储层只 flush，事务边界在 service 层（评审 G1）
        return None

    def commit(self):
        return None

    def refresh(self, _obj):
        return None

    def query(self, *_args, **_kwargs):  # pragma: no cover - 本文件用不到
        raise AssertionError("unexpected query")


def _create(session: FakeSession, api_key: str) -> str:
    created = ProviderService.create(
        session,  # type: ignore[arg-type]
        ProviderCreate(
            kind="openai-compat",
            name="测试服务商",
            base_url="https://example.com/v1",
            api_key=api_key,
            default_model="m",
        ),
    )
    return created.id


async def test_saved_provider_test_uses_stored_key(monkeypatch) -> None:
    session = FakeSession()
    pid = _create(session, "sk-secret-123456")
    adapter = FakeAdapter()
    captured: dict = {}

    def _fake_adapter(kind, base_url, api_key, default_model):
        captured.update(kind=kind, base_url=base_url, api_key=api_key)
        return adapter

    monkeypatch.setattr(provider_service, "_adapter", _fake_adapter)

    result = await ProviderService.test_saved(session, pid)  # type: ignore[arg-type]

    assert result is not None and result.ok is True
    assert captured["api_key"] == "sk-secret-123456", "必须用库里解密出来的密钥"
    assert adapter.calls and adapter.calls[0]["user"] == "ping"


async def test_unknown_provider_returns_none() -> None:
    session = FakeSession()
    assert await ProviderService.test_saved(session, "pv_missing") is None  # type: ignore[arg-type]


async def test_broken_key_gives_readable_error(monkeypatch) -> None:
    session = FakeSession()
    pid = _create(session, "sk-secret-123456")
    # 直接把密文改成非法值，模拟主密钥被替换
    session.rows[pid].api_key_enc = "garbage-ciphertext"  # type: ignore[attr-defined]

    result = await ProviderService.test_saved(session, pid)  # type: ignore[arg-type]

    assert result is not None and result.ok is False
    assert "无法解密" in result.message
