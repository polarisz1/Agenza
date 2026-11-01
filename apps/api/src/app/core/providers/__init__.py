"""服务商适配层（纯适配器，不碰数据库）。

**分层约定（AGENTS §2.2 / 评审 A2）**：`core/` 是横切关注点，不得反向依赖
`modules/`。此前这里有一份 `get_providers_registry(session)`，直接 import
`modules.providers.repository` 去查库——现在装载逻辑下沉到
`modules/providers/service.py::build_registry()`，core 只保留适配器与注册表容器。

本模块只导出：
- `ProviderAdapter` / `ProviderRegistry` / `ChatResult`（契约）
- 三个具体适配器（OpenAI 兼容 / Ollama / Anthropic 兼容）
"""

from __future__ import annotations

from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.base import (
    ChatResult,
    ProviderAdapter,
    ProviderError,
    ProviderRegistry,
    UnusableProvider,
)
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider

__all__ = [
    "AnthropicCompatProvider",
    "ChatResult",
    "OllamaProvider",
    "OpenAICompatProvider",
    "ProviderAdapter",
    "ProviderError",
    "ProviderRegistry",
    "UnusableProvider",
]
