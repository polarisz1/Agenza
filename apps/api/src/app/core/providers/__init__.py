"""FastAPI dependency - ProviderRegistry bootstrap."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.base import ProviderRegistry
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider
from app.core.security import KeyManager
from app.modules.providers.repository import ProviderRepository

_registry = ProviderRegistry()


def get_providers_registry(session: Session | None = None) -> ProviderRegistry:
    """Load all enabled providers into the singleton registry."""
    _registry.clear()
    sess = session or next(get_session())
    try:
        db_providers = ProviderRepository.list_enabled(sess)
        for p in db_providers:
            adapter = _build_adapter(
                p.kind, p.base_url, KeyManager.decrypt(p.api_key_enc), p.default_model
            )
            if adapter:
                _registry.register(p.id, adapter)
    finally:
        if session is None:
            sess.close()
    return _registry


def _build_adapter(kind: str, base_url: str, api_key: str | None, default_model: str | None):
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
