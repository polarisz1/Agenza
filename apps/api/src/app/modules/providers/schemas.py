"""Provider Pydantic schemas."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ProviderKind = Literal["openai-compat", "ollama", "anthropic-compat"]


class ProviderCreate(BaseModel):
    kind: ProviderKind
    name: str = Field(..., min_length=1, max_length=200)
    base_url: str = Field(..., min_length=1)
    api_key: str | None = None
    default_model: str | None = None


class ProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    default_model: str | None = None
    enabled: bool | None = None


class ProviderResponse(BaseModel):
    id: str
    kind: ProviderKind
    name: str
    base_url: str
    api_key_masked: str
    default_model: str | None = None
    enabled: bool
    created_at: datetime | None = None


class ProviderTestResult(BaseModel):
    ok: bool
    message: str = ""
    model: str | None = None


class ProviderListData(BaseModel):
    items: list[ProviderResponse]
