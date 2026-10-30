"""Settings schemas."""

from pydantic import BaseModel


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
