"""AI Gateway router（GATE-01）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.exceptions import AppError
from app.core.response import ERROR_RESPONSES, ApiResponse, DeleteResult, success
from app.modules.gateway.schemas import (
    GatewayConfigResponse,
    GatewayConfigUpdate,
    GatewayResolveResponse,
    GatewayRouteItem,
    GatewayRouteListData,
    GatewayRouteUpsert,
    GatewayUsageResponse,
    TaskType,
)
from app.modules.gateway.service import GatewayService

router = APIRouter(prefix="/gateway", responses=ERROR_RESPONSES, tags=["v1-gateway"])


@router.get("/config", response_model=ApiResponse[GatewayConfigResponse])
def get_gateway_config(session: Session = Depends(get_session)):
    return success(GatewayService.get_config(session))


@router.put("/config", response_model=ApiResponse[GatewayConfigResponse])
def update_gateway_config(body: GatewayConfigUpdate, session: Session = Depends(get_session)):
    return success(GatewayService.update_config(session, body))


@router.get("/routes", response_model=ApiResponse[GatewayRouteListData])
def list_gateway_routes(session: Session = Depends(get_session)):
    return success({"items": GatewayService.list_routes(session)})


@router.post("/routes", response_model=ApiResponse[GatewayRouteItem])
def upsert_gateway_route(body: GatewayRouteUpsert, session: Session = Depends(get_session)):
    """按 task_type upsert：同一 workspace 每个任务类型只保留一条策略。"""
    return success(GatewayService.upsert_route(session, body))


@router.delete("/routes/{route_id}", response_model=ApiResponse[DeleteResult])
def delete_gateway_route(route_id: str, session: Session = Depends(get_session)):
    if not GatewayService.delete_route(session, route_id):
        raise AppError(404, "Route not found")
    return success({"deleted": True})


@router.get("/usage", response_model=ApiResponse[GatewayUsageResponse])
def gateway_usage(
    days: int = Query(30, ge=1, le=365),
    session: Session = Depends(get_session),
):
    return success(GatewayService.usage(session, days))


@router.get("/resolve", response_model=ApiResponse[GatewayResolveResponse])
def resolve_model(
    task_type: TaskType = Query("default"),
    session: Session = Depends(get_session),
):
    """预览当前策略：该任务类型会选中哪个服务商/模型，或是否已被预算停机。"""
    return success(GatewayService.resolve(session, task_type))
