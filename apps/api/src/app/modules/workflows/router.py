"""Workflow FastAPI router."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api_deps import get_session
from app.core.exceptions import AppError
from app.core.response import ERROR_RESPONSES, ApiResponse, DeleteResult, success
from app.modules.runs.schemas import RunCreate, RunResponse
from app.modules.runs.service import RunService
from app.modules.workflows.schemas import (
    DuplicateResult,
    GraphDef,
    NodeTestRequest,
    NodeTestResult,
    ValidateResult,
    WorkflowCreate,
    WorkflowImportRequest,
    WorkflowImportResult,
    WorkflowListData,
    WorkflowResponse,
    WorkflowUpdate,
    WorkflowVersionDetail,
    WorkflowVersionListData,
)
from app.modules.workflows.service import WorkflowService

router = APIRouter(responses=ERROR_RESPONSES)


@router.get("", response_model=ApiResponse[WorkflowListData])
def list_workflows(
    q: str | None = Query(default=None),
    status: str | None = Query(default=None),
    sort: str = Query(default="updated_desc"),
    session: Session = Depends(get_session),
):
    items = WorkflowService.list(session, q=q, status=status, sort=sort)
    return success({"items": items})


@router.post("", response_model=ApiResponse[WorkflowResponse])
def create_workflow(body: WorkflowCreate, session: Session = Depends(get_session)):
    wf = WorkflowService.create(session, body)
    return success(wf)


@router.post("/import", response_model=ApiResponse[WorkflowImportResult])
def import_workflows(body: WorkflowImportRequest, session: Session = Depends(get_session)):
    """导入工作流：confirm=false 预览（含重名副本命名），confirm=true 写入。"""
    result = WorkflowService.import_workflows(session, body)
    return success(result)


@router.post("/validate", response_model=ApiResponse[ValidateResult])
def validate_graph_body(body: GraphDef, session: Session = Depends(get_session)):
    """校验任意（未保存）图结构。"""
    result = WorkflowService.validate(session, body)
    return success(result)


@router.get("/{wf_id}", response_model=ApiResponse[WorkflowResponse])
def get_workflow(wf_id: str, session: Session = Depends(get_session)):
    wf = WorkflowService.get(session, wf_id)
    if not wf:
        raise AppError(404, "Workflow not found")
    return success(wf)


@router.put("/{wf_id}", response_model=ApiResponse[WorkflowResponse])
def update_workflow(wf_id: str, body: WorkflowUpdate, session: Session = Depends(get_session)):
    wf = WorkflowService.update(session, wf_id, body)
    if not wf:
        raise AppError(404, "Workflow not found")
    return success(wf)


@router.delete("/{wf_id}", response_model=ApiResponse[DeleteResult])
def delete_workflow(
    wf_id: str, confirm: bool = Query(default=False), session: Session = Depends(get_session)
):
    if not confirm:
        raise AppError(400, "Pass ?confirm=true to delete")
    ok = WorkflowService.delete(session, wf_id)
    if not ok:
        raise AppError(404, "Workflow not found")
    return success({"deleted": True})


@router.post("/{wf_id}/duplicate", response_model=ApiResponse[DuplicateResult])
def duplicate_workflow(wf_id: str, session: Session = Depends(get_session)):
    dup = WorkflowService.duplicate(session, wf_id)
    if not dup:
        raise AppError(404, "Workflow not found")
    return success(dup)


@router.post("/{wf_id}/validate", response_model=ApiResponse[ValidateResult])
def validate_workflow(
    wf_id: str, body: GraphDef | None = None, session: Session = Depends(get_session)
):
    """校验：给了 body 就校验 body，否则校验已保存的图。"""
    if body is not None:
        return success(WorkflowService.validate(session, body))

    wf = WorkflowService.get(session, wf_id)
    if not wf:
        raise AppError(404, "Workflow not found")
    return success(WorkflowService.validate(session, wf.graph))


@router.get("/{wf_id}/validate", response_model=ApiResponse[ValidateResult])
def validate_workflow_saved(wf_id: str, session: Session = Depends(get_session)):
    """校验已保存的工作流图。"""
    wf = WorkflowService.get(session, wf_id)
    if not wf:
        raise AppError(404, "Workflow not found")
    return success(WorkflowService.validate(session, wf.graph))


@router.get("/{wf_id}/versions", response_model=ApiResponse[WorkflowVersionListData])
def list_workflow_versions(wf_id: str, session: Session = Depends(get_session)):
    """版本历史（F5）：按 seq 倒序。"""
    if not WorkflowService.get(session, wf_id):
        raise AppError(404, "Workflow not found")
    return success({"items": WorkflowService.list_versions(session, wf_id)})


@router.get("/{wf_id}/versions/{version_id}", response_model=ApiResponse[WorkflowVersionDetail])
def get_workflow_version(wf_id: str, version_id: str, session: Session = Depends(get_session)):
    version = WorkflowService.get_version(session, wf_id, version_id)
    if version is None:
        raise AppError(404, "Version not found")
    return success(version)


@router.post(
    "/{wf_id}/versions/{version_id}/restore",
    response_model=ApiResponse[WorkflowResponse],
)
def restore_workflow_version(wf_id: str, version_id: str, session: Session = Depends(get_session)):
    """恢复到某个版本；恢复本身会生成一个新的版本记录（F5）。"""
    updated = WorkflowService.restore_version(session, wf_id, version_id)
    if updated is None:
        raise AppError(404, "Workflow or version not found")
    return success(updated)


@router.post("/{wf_id}/runs", response_model=ApiResponse[RunResponse])
async def run_workflow(
    wf_id: str,
    body: RunCreate,
    session: Session = Depends(get_session),
):
    """发起一次手动运行，立即返回 run_id，后续通过 SSE 观察进度。"""
    run = await RunService.start_run(session, wf_id, body.inputs, trigger="manual")
    return success(run)


@router.post("/{wf_id}/nodes/{node_id}/test", response_model=ApiResponse[NodeTestResult])
async def test_node(
    wf_id: str,
    node_id: str,
    body: NodeTestRequest | None = None,
    session: Session = Depends(get_session),
):
    """单节点调试：只执行该节点，不写运行记录。"""
    payload = body or NodeTestRequest()
    result = await WorkflowService.test_node(
        session,
        wf_id,
        node_id,
        inputs=payload.inputs,
        upstream=payload.upstream,
    )
    return success(result)
