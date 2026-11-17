"""Provider service."""

from __future__ import annotations

import uuid

import httpx
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.logger import log
from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.base import (
    ProviderAdapter,
    ProviderRegistry,
    UnusableProvider,
    describe_http_error,
)
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider
from app.core.security import KeyDecryptError, KeyManager
from app.core.time import utcnow
from app.modules.providers.models import Provider
from app.modules.providers.repository import ProviderRepository
from app.modules.providers.schemas import (
    ProviderCreate,
    ProviderResponse,
    ProviderTestResult,
    ProviderUpdate,
)


def build_registry(session: Session) -> ProviderRegistry:
    """按当前数据库内容构建一份服务商**快照**（评审 S4 / A2）。

    每次调用都是新实例：运行中的节点持有自己那次的快照，此时用户去
    「单节点调试」或发起新运行，不会把在途节点的 provider 清空。
    放在模块层（而非 core）是因为它需要读库——core 不得反向依赖 modules。
    """
    registry = ProviderRegistry()
    for provider in ProviderRepository.list_enabled(session):
        try:
            api_key = KeyManager.decrypt(provider.api_key_enc)
        except KeyDecryptError as exc:
            # 密钥解不开：注册一个会明确报错的占位实现，而不是拿空串去请求（那样只会 401）
            log.warning(f"Provider {provider.id} 密钥无法解密：{exc}")
            registry.register(provider.id, UnusableProvider(str(exc)))
            continue

        adapter = _adapter(
            provider.kind,
            provider.base_url,
            api_key,
            provider.default_model,
        )
        if adapter:
            registry.register(provider.id, adapter)
    return registry


def _masked(key_enc: str | None) -> str:
    if not key_enc:
        return "（未设置）"
    try:
        raw = KeyManager.decrypt(key_enc)
    except KeyDecryptError:
        return "（无法解密，请重新填写）"
    except Exception:
        return "••••"
    if len(raw) <= 6:
        return "••••"
    return f"••••{raw[-4:]}"


def _adapter(kind: str, base_url: str, api_key: str | None, default_model: str | None):
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


class ProviderService:
    @staticmethod
    def create(session: Session, body: ProviderCreate) -> ProviderResponse:
        pid = f"pv_{uuid.uuid4().hex[:10]}"
        key_enc = KeyManager.encrypt(body.api_key) if body.api_key else None
        obj = Provider(
            id=pid,
            kind=body.kind,
            name=body.name,
            base_url=body.base_url,
            api_key_enc=key_enc,
            default_model=body.default_model,
            enabled=True,
            created_at=utcnow(),
        )
        created = ProviderRepository.create(session, obj)
        session.commit()
        return _to_response(created)

    @staticmethod
    def list(session: Session) -> list[ProviderResponse]:
        return [_to_response(p) for p in ProviderRepository.list(session)]

    @staticmethod
    def count(session: Session) -> int:
        return len(ProviderRepository.list(session))

    @staticmethod
    def get(session: Session, pid: str) -> ProviderResponse | None:
        p = ProviderRepository.get(session, pid)
        return _to_response(p) if p else None

    @staticmethod
    def update(session: Session, pid: str, body: ProviderUpdate) -> ProviderResponse | None:
        p = ProviderRepository.get(session, pid)
        if not p:
            return None
        fields = {}
        if body.name is not None:
            fields["name"] = body.name
        if body.base_url is not None:
            fields["base_url"] = body.base_url
        if body.api_key is not None:
            fields["api_key_enc"] = KeyManager.encrypt(body.api_key) if body.api_key else None
        if body.default_model is not None:
            fields["default_model"] = body.default_model
        if body.enabled is not None:
            fields["enabled"] = body.enabled
        updated = ProviderRepository.update(session, pid, **fields)
        session.commit()
        return _to_response(updated) if updated else None

    @staticmethod
    def delete(session: Session, pid: str) -> bool:
        ok = ProviderRepository.delete(session, pid)
        session.commit()
        return ok

    @staticmethod
    async def list_models(session: Session, pid: str) -> list[str] | None:
        """拉取服务商可用模型（F3）；provider 不存在返回 None。"""
        provider = ProviderRepository.get(session, pid)
        if provider is None:
            return None
        try:
            api_key = KeyManager.decrypt(provider.api_key_enc)
        except KeyDecryptError:
            return []
        adapter = _adapter(provider.kind, provider.base_url, api_key, provider.default_model)
        if adapter is None:
            return []
        try:
            return await adapter.list_models()
        except httpx.HTTPStatusError as exc:
            raise AppError(502, f"获取模型列表失败：{describe_http_error(exc)}") from exc
        except httpx.RequestError as exc:
            raise AppError(502, f"无法连接服务商：{exc}") from exc

    @staticmethod
    async def test(body: ProviderCreate) -> ProviderTestResult:
        """用表单里填的明文密钥测（保存前试连）。"""
        adapter = _adapter(body.kind, body.base_url, body.api_key, body.default_model)
        if not adapter:
            return ProviderTestResult(ok=False, message=f"Unsupported kind: {body.kind}")
        return await _probe(adapter, body.default_model)

    @staticmethod
    async def test_saved(session: Session, pid: str) -> ProviderTestResult | None:
        """用库里已保存的配置（含解密后的密钥）测（评审 F5）。

        此前前端"测试连接"不带密钥，已保存的服务商必然返回鉴权失败。
        """
        provider = ProviderRepository.get(session, pid)
        if provider is None:
            return None

        try:
            api_key = KeyManager.decrypt(provider.api_key_enc)
        except KeyDecryptError:
            return ProviderTestResult(
                ok=False, message="密钥无法解密（主密钥可能已更换），请重新填写 API Key"
            )

        adapter = _adapter(provider.kind, provider.base_url, api_key, provider.default_model)
        if not adapter:
            return ProviderTestResult(ok=False, message=f"Unsupported kind: {provider.kind}")
        return await _probe(adapter, provider.default_model)


async def _probe(adapter: ProviderAdapter, model: str | None) -> ProviderTestResult:
    try:
        result = await adapter.chat(
            model=model,
            system="",
            user="ping",
            temperature=0,
            max_tokens=8,
        )
        return ProviderTestResult(ok=True, message="Connection OK", model=result.model)
    except httpx.HTTPStatusError as exc:
        return ProviderTestResult(ok=False, message=describe_http_error(exc))
    except httpx.TimeoutException:
        return ProviderTestResult(ok=False, message="连接超时：服务地址无响应")
    except httpx.ConnectError:
        return ProviderTestResult(ok=False, message="无法连接到服务地址：请检查地址与网络")
    except Exception as exc:
        return ProviderTestResult(ok=False, message=str(exc))


def _to_response(p: Provider) -> ProviderResponse:
    return ProviderResponse(
        id=p.id,
        kind=p.kind,
        name=p.name,
        base_url=p.base_url,
        api_key_masked=_masked(p.api_key_enc),
        default_model=p.default_model,
        enabled=p.enabled,
        created_at=p.created_at,
    )
