"""Provider router."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.exceptions import AppError
from app.core.response import ApiResponse, DeleteResult, success
from app.modules.providers.schemas import (
    ProviderCreate,
    ProviderListData,
    ProviderResponse,
    ProviderTestResult,
    ProviderUpdate,
)
from app.modules.providers.service import ProviderService

router = APIRouter()


@router.get("", response_model=ApiResponse[ProviderListData])
def list_providers(session: Session = Depends(get_session)):
    return success({"items": ProviderService.list(session)})


@router.post("", response_model=ApiResponse[ProviderResponse])
def create_provider(body: ProviderCreate, session: Session = Depends(get_session)):
    return success(ProviderService.create(session, body))


@router.post("/test", response_model=ApiResponse[ProviderTestResult])
async def test_provider(body: ProviderCreate):
    return success(await ProviderService.test(body))


@router.get("/{pid}", response_model=ApiResponse[ProviderResponse])
def get_provider(pid: str, session: Session = Depends(get_session)):
    p = ProviderService.get(session, pid)
    if not p:
        raise AppError(404, "Provider not found")
    return success(p)


@router.put("/{pid}", response_model=ApiResponse[ProviderResponse])
def update_provider(pid: str, body: ProviderUpdate, session: Session = Depends(get_session)):
    p = ProviderService.update(session, pid, body)
    if not p:
        raise AppError(404, "Provider not found")
    return success(p)


@router.delete("/{pid}", response_model=ApiResponse[DeleteResult])
def delete_provider(pid: str, session: Session = Depends(get_session)):
    ok = ProviderService.delete(session, pid)
    if not ok:
        raise AppError(404, "Provider not found")
    return success({"deleted": True})
