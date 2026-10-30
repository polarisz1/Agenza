"""Provider service."""

from __future__ import annotations

import uuid
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from app.core.providers.anthropic_compat import AnthropicCompatProvider
from app.core.providers.base import describe_http_error
from app.core.providers.ollama import OllamaProvider
from app.core.providers.openai_compat import OpenAICompatProvider
from app.core.security import KeyDecryptError, KeyManager
from app.modules.providers.models import Provider
from app.modules.providers.repository import ProviderRepository
from app.modules.providers.schemas import (
    ProviderCreate,
    ProviderResponse,
    ProviderTestResult,
    ProviderUpdate,
)


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
            created_at=datetime.utcnow(),
        )
        created = ProviderRepository.create(session, obj)
        return _to_response(created)

    @staticmethod
    def list(session: Session) -> list[ProviderResponse]:
        return [_to_response(p) for p in ProviderRepository.list(session)]

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
        return _to_response(updated) if updated else None

    @staticmethod
    def delete(session: Session, pid: str) -> bool:
        return ProviderRepository.delete(session, pid)

    @staticmethod
    async def test(body: ProviderCreate) -> ProviderTestResult:
        adapter = _adapter(body.kind, body.base_url, body.api_key, body.default_model)
        if not adapter:
            return ProviderTestResult(ok=False, message=f"Unsupported kind: {body.kind}")
        try:
            result = await adapter.chat(
                model=body.default_model,
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
