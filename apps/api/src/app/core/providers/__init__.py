"""服务商注册表装载。

每次调用都构造**新的** ProviderRegistry（快照），不再复用模块级单例：
运行中的节点持有自己那次的快照，此时用户去「单节点调试」或发起新运行，
不会把在途节点的 provider 清空（评审 S4）。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.logger import log
from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.base import ProviderAdapter, ProviderRegistry, UnusableProvider
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider
from app.core.security import KeyDecryptError, KeyManager
from app.modules.providers.repository import ProviderRepository


def get_providers_registry(session: Session) -> ProviderRegistry:
    """按当前数据库内容构建一份服务商快照。"""
    registry = ProviderRegistry()
    for provider in ProviderRepository.list_enabled(session):
        try:
            api_key = KeyManager.decrypt(provider.api_key_enc)
        except KeyDecryptError as exc:
            # 密钥解不开：注册一个会明确报错的占位实现，而不是拿空串去请求（那样只会 401）
            log.warning(f"Provider {provider.id} 密钥无法解密：{exc}")
            registry.register(provider.id, UnusableProvider(str(exc)))
            continue

        adapter = _build_adapter(
            provider.kind,
            provider.base_url,
            api_key,
            provider.default_model,
        )
        if adapter:
            registry.register(provider.id, adapter)
    return registry


def _build_adapter(
    kind: str, base_url: str, api_key: str | None, default_model: str | None
) -> ProviderAdapter | None:
    if kind == "ollama":
        return OllamaProvider(base_url=base_url, default_model=default_model)
    if kind == "openai-compat":
        return OpenAICompatProvider(
            base_url=base_url, api_key=api_key or "", default_model=default_model
        )
    if kind == "anthropic-compat":
        return AnthropicCompatProvider(
            base_url=base_url, api_key=api_key or "", default_model=default_model
        )
    return None
