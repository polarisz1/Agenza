"""Settings schemas."""

from pydantic import BaseModel, Field


class SettingsUpdate(BaseModel):
    """设置更新请求体（评审 G4）。

    以前是 `data: dict`，OpenAPI 里变成无类型 object，前端只能猜字段名。
    现在每个字段都显式声明并带取值约束；未传的字段保持原值。
    """

    auto_save: bool | None = None
    retention_per_workflow: int | None = Field(default=None, ge=1, le=5000)
    default_timeout: int | None = Field(default=None, ge=1, le=3600)
    language: str | None = Field(default=None, max_length=20)


class SettingsResponse(BaseModel):
    auto_save: bool
    retention_per_workflow: int
    default_timeout: int
    language: str
    data_dir: str
    app_version: str


class SystemInfo(BaseModel):
    app_name: str
    version: str
    data_dir: str
    db_url: str
    workflow_count: int
    run_count: int
    provider_count: int
