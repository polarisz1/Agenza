"""Settings router."""

from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.response import ApiResponse, ClearResult, success
from app.modules.settings.schemas import SettingsResponse, SystemInfo
from app.modules.settings.service import SettingsService

router = APIRouter()


@router.get("", response_model=ApiResponse[SettingsResponse])
def get_settings(session: Session = Depends(get_session)):
    return success(SettingsService.get_all(session))


@router.put("", response_model=ApiResponse[SettingsResponse])
def update_settings(data: dict = Body(...), session: Session = Depends(get_session)):
    return success(SettingsService.update(session, data))


@router.post("/system/clear-runs", response_model=ApiResponse[ClearResult])
def clear_runs(session: Session = Depends(get_session)):
    from app.modules.runs.models import Run

    count = session.query(Run).count()
    session.query(Run).delete()
    session.commit()
    return success({"cleared": count})


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
    from app.core.config import settings
    from app.modules.providers.models import Provider
    from app.modules.runs.models import Run
    from app.modules.workflows.models import Workflow

    return success(
        {
            "app_name": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "data_dir": settings.DATA_DIR,
            "db_url": settings.effective_database_url,
            "workflow_count": session.query(Workflow).count(),
            "run_count": session.query(Run).count(),
            "provider_count": session.query(Provider).count(),
        }
    )
