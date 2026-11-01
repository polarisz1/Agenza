"""密钥解密失败的行为（G18）：不再静默变成空串。

- KeyManager.decrypt 抛 KeyDecryptError
- 装载注册表时该服务商变成 UnusableProvider，调用时给出可读错误
- 列表里的掩码显示"无法解密"，而不是无害的 ••••
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.engine.contexts import NodeContext
from app.core.engine.executors.llm import LLMExecutor
from app.core.providers.base import ProviderError, ProviderRegistry, UnusableProvider
from app.core.security import KeyDecryptError, KeyManager
from app.modules.providers import service as providers_service
from app.modules.providers.service import _masked


def test_decrypt_raises_on_bad_ciphertext() -> None:
    with pytest.raises(KeyDecryptError):
        KeyManager.decrypt("这不是一个合法的 Fernet 密文")


def test_masked_shows_explicit_hint_for_broken_key() -> None:
    assert "无法解密" in _masked("garbage-ciphertext")


def test_registry_registers_unusable_provider_when_key_is_broken(monkeypatch) -> None:
    broken = SimpleNamespace(
        id="pv_broken",
        kind="openai-compat",
        base_url="https://example.com/v1",
        api_key_enc="garbage-ciphertext",
        default_model="m",
    )
    monkeypatch.setattr(
        providers_service.ProviderRepository, "list_enabled", lambda _session: [broken]
    )

    registry = providers_service.build_registry(session=object())  # type: ignore[arg-type]

    adapter = registry.get("pv_broken")
    assert isinstance(adapter, UnusableProvider)


async def test_unusable_provider_raises_clear_error() -> None:
    adapter = UnusableProvider("密钥无法解密（主密钥可能已更换）")

    with pytest.raises(ProviderError) as excinfo:
        await adapter.chat(model="m", user="hi")

    assert "密钥无法解密" in str(excinfo.value)


async def test_llm_node_surfaces_broken_key_to_user() -> None:
    """端到端：LLM 节点应当把"密钥无法解密"直接写进节点错误里。"""
    registry = ProviderRegistry()
    registry.register("pv_broken", UnusableProvider("密钥无法解密，请重新填写 API Key"))

    ctx = NodeContext(
        node={"id": "l1", "type": "llm", "name": "LLM", "config": {"provider_id": "pv_broken"}},
        run_inputs={},
        providers=registry,
    )

    result = await LLMExecutor().execute(ctx)

    assert result.status == "failed"
    assert "密钥无法解密" in (result.error or "")
