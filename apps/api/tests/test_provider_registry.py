"""Provider 注册表快照单测（S4）。

关键行为：两次装载得到**互不影响**的注册表实例——否则运行中做单节点调试会把
在途节点正在用的 provider 清空。
"""

from __future__ import annotations

from types import SimpleNamespace

from app.core.security import KeyManager
from app.modules.providers import service as providers_service


def _fake_provider(pid: str, kind: str = "openai-compat") -> SimpleNamespace:
    return SimpleNamespace(
        id=pid,
        kind=kind,
        base_url="https://example.com/v1",
        api_key_enc=KeyManager.encrypt("sk-test"),
        default_model="m",
    )


def test_each_call_returns_an_isolated_snapshot(monkeypatch) -> None:
    rows = [_fake_provider("pv_1"), _fake_provider("pv_2", kind="ollama")]
    monkeypatch.setattr(providers_service.ProviderRepository, "list_enabled", lambda _session: rows)

    first = providers_service.build_registry(session=object())  # type: ignore[arg-type]
    second = providers_service.build_registry(session=object())  # type: ignore[arg-type]

    assert first is not second, "必须是新实例，不能共用模块级单例"
    assert first.get("pv_1") is not None
    assert second.get("pv_1") is not None

    first.clear()
    assert first.get("pv_1") is None
    assert second.get("pv_1") is not None, "清空一份快照不应影响另一份"


def test_unknown_provider_kind_is_skipped(monkeypatch) -> None:
    rows = [_fake_provider("pv_x", kind="mystery")]
    monkeypatch.setattr(providers_service.ProviderRepository, "list_enabled", lambda _session: rows)

    registry = providers_service.build_registry(session=object())  # type: ignore[arg-type]

    assert registry.get("pv_x") is None
