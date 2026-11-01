"""Settings router."""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.config import settings
from app.core.response import ApiResponse, ClearResult, success
from app.modules.providers.service import ProviderService
from app.modules.runs.service import RunService
from app.modules.settings.schemas import SettingsResponse, SettingsUpdate, SystemInfo
from app.modules.settings.service import SettingsService
from app.modules.workflows.service import WorkflowService

router = APIRouter()


@router.get("", response_model=ApiResponse[SettingsResponse])
def get_settings(session: Session = Depends(get_session)):
    return success(SettingsService.get_all(session))


@router.put("", response_model=ApiResponse[SettingsResponse])
def update_settings(body: SettingsUpdate, session: Session = Depends(get_session)):
    """更新本机设置（只校验并接受已声明的字段）。"""
    return success(SettingsService.update(session, body.model_dump(exclude_none=True)))


@router.post("/system/clear-runs", response_model=ApiResponse[ClearResult])
def clear_runs(session: Session = Depends(get_session)):
    """清空全部运行记录（含节点级记录，走 runs 模块的 service）。"""
    return success({"cleared": RunService.clear_all(session)})


@router.get("/system/export")
def export_backup(session: Session = Depends(get_session)):
    """导出备份 JSON（设置 + 全部工作流，不含服务商密钥）。"""
    payload = SettingsService.export_backup(session)
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    filename = f"agentflow-backup-{datetime.now():%Y%m%d-%H%M%S}.json"
    return Response(
        content=body,
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/system/info", response_model=ApiResponse[SystemInfo])
def system_info(session: Session = Depends(get_session)):
    """系统信息：各 feature 的计数统一通过对方 service 获取（AGENTS §2.1）。"""
    return success(
        {
            "app_name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "data_dir": settings.DATA_DIR,
            "db_url": settings.effective_database_url,
            "workflow_count": WorkflowService.count(session),
            "run_count": RunService.count(session),
            "provider_count": ProviderService.count(session),
        }
    )
