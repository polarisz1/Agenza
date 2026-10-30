"""Workflow service - orchestrates repository + validator."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.engine.contexts import NodeContext
from app.core.engine.registry import build_default_registry
from app.core.engine.validators import validate_graph
from app.core.exceptions import AppError
from app.core.providers import get_providers_registry
from app.modules.workflows.repository import WorkflowRepository
from app.modules.workflows.schemas import (
    DuplicateResult,
    GraphDef,
    NodeTestResult,
    ValidateResult,
    WorkflowCreate,
    WorkflowImportItem,
    WorkflowImportRequest,
    WorkflowImportResult,
    WorkflowListItem,
    WorkflowResponse,
    WorkflowUpdate,
)


class WorkflowService:
    @staticmethod
    def create(session: Session, body: WorkflowCreate) -> WorkflowResponse:
        wf_id = f"wf_{uuid.uuid4().hex[:10]}"
        obj = WorkflowRepository.create(
            session,
            wf_id=wf_id,
            name=body.name,
            description=body.description,
            graph_json=body.graph.model_dump_json(),
        )
        return _to_response(obj)

    @staticmethod
    def get(session: Session, wf_id: str) -> WorkflowResponse | None:
        obj = WorkflowRepository.get(session, wf_id)
        if not obj:
            return None
        return _to_response(obj)

    @staticmethod
    def list(
        session: Session,
        q: str | None = None,
        status: str | None = None,
        sort: str = "updated_desc",
    ) -> list[WorkflowListItem]:
        objs, _ = WorkflowRepository.list(session, q=q, status=status, sort=sort)
        out = []
        for obj in objs:
            try:
                graph = json.loads(obj.graph_json)
                node_count = len(graph.get("nodes", []))
            except Exception:
                node_count = 0
            out.append(
                WorkflowListItem(
                    id=obj.id,
                    name=obj.name,
                    description=obj.description,
                    status=obj.status,
                    node_count=node_count,
                    last_run_at=obj.last_run_at,
                    updated_at=obj.updated_at,
                )
            )
        return out

    @staticmethod
    def update(session: Session, wf_id: str, body: WorkflowUpdate) -> WorkflowResponse | None:
        obj = WorkflowRepository.get(session, wf_id)
        if not obj:
            return None

        graph_json = body.graph.model_dump_json() if body.graph else None
        viewport_json = json.dumps(body.viewport) if body.viewport is not None else None

        # Auto-set status: ready 需无环且无校验问题（至少一个输入与输出）
        new_status = None
        if body.graph is not None:
            result = WorkflowService._validate_dict(body.graph.model_dump())
            new_status = "ready" if result["ok"] and not result["issues"] else "draft"

        updated = WorkflowRepository.update(
            session,
            wf_id,
            name=body.name,
            description=body.description,
            graph_json=graph_json,
            viewport_json=viewport_json,
            status=body.status or new_status,
        )
        return _to_response(updated) if updated else None

    @staticmethod
    def delete(session: Session, wf_id: str) -> bool:
        return WorkflowRepository.delete(session, wf_id)

    @staticmethod
    def duplicate(session: Session, wf_id: str) -> DuplicateResult | None:
        obj = WorkflowRepository.get(session, wf_id)
        if not obj:
            return None
        new_id = f"wf_{uuid.uuid4().hex[:10]}"
        dup_obj = WorkflowRepository.create(
            session,
            wf_id=new_id,
            name=f"{obj.name} 副本",
            description=obj.description,
            graph_json=obj.graph_json,
        )
        if obj.viewport_json:
            WorkflowRepository.update(session, new_id, viewport_json=obj.viewport_json)
        return DuplicateResult(id=dup_obj.id, name=dup_obj.name)

    @staticmethod
    def validate(session: Session, graph: GraphDef) -> ValidateResult:
        result = WorkflowService._validate_dict(graph.model_dump())
        return ValidateResult(ok=result["ok"], issues=result["issues"])

    @staticmethod
    def export_all(session: Session) -> list[dict]:
        """导出全部工作流（不含服务商/密钥）。"""
        objs, _ = WorkflowRepository.list(session)
        out: list[dict] = []
        for obj in objs:
            try:
                graph = json.loads(obj.graph_json)
            except Exception:
                graph = {"version": 1, "inputs": [], "nodes": [], "edges": []}
            out.append(
                {
                    "name": obj.name,
                    "description": obj.description,
                    "graph": graph,
                    "viewport": json.loads(obj.viewport_json) if obj.viewport_json else None,
                }
            )
        return out

    @staticmethod
    def import_workflows(session: Session, body: WorkflowImportRequest) -> WorkflowImportResult:
        """导入工作流：confirm=false 只返回预览（含重名处理），confirm=true 才写入。"""
        entries = _normalize_import_payload(body.payload)
        objs, _ = WorkflowRepository.list(session)
        existing = {obj.name for obj in objs}

        items: list[WorkflowImportItem] = []
        created_ids: list[str] = []

        for entry in entries:
            name = str(entry.get("name") or "导入工作流").strip() or "导入工作流"
            graph = entry.get("graph")
            if not isinstance(graph, dict):
                raise AppError(422, f"「{name}」缺少 graph")
            graph.setdefault("version", 1)
            graph.setdefault("inputs", [])
            graph.setdefault("nodes", [])
            graph.setdefault("edges", [])

            target = _unique_name(name, existing)
            items.append(
                WorkflowImportItem(
                    name=name,
                    target_name=target,
                    node_count=len(graph.get("nodes", [])),
                    conflict=target != name,
                )
            )
            if not body.confirm:
                continue

            wf_id = f"wf_{uuid.uuid4().hex[:10]}"
            WorkflowRepository.create(
                session,
                wf_id=wf_id,
                name=target,
                description=entry.get("description"),
                graph_json=json.dumps(graph, ensure_ascii=False),
            )
            if entry.get("viewport"):
                WorkflowRepository.update(
                    session, wf_id, viewport_json=json.dumps(entry["viewport"])
                )
            existing.add(target)
            created_ids.append(wf_id)

        return WorkflowImportResult(items=items, created_ids=created_ids)

    @staticmethod
    def mark_run(session: Session, wf_id: str) -> None:
        """记录最近一次运行时间（供 run 模块收尾时调用）。"""
        WorkflowRepository.mark_run(session, wf_id)

    @staticmethod
    async def test_node(
        session: Session,
        wf_id: str,
        node_id: str,
        inputs: dict | None = None,
        upstream: dict | None = None,
    ) -> NodeTestResult:
        """单节点调试：只执行指定节点，不写 run / node_run。"""
        obj = WorkflowRepository.get(session, wf_id)
        if not obj:
            raise AppError(404, "Workflow not found")

        graph = json.loads(obj.graph_json)
        node = next((n for n in graph.get("nodes", []) if n.get("id") == node_id), None)
        if node is None:
            raise AppError(404, "Node not found")

        merged_upstream = dict(upstream or {})
        available: dict[str, Any] = dict(merged_upstream)
        if not merged_upstream:
            # 上游默认取最近一次成功运行的输出；延迟导入避免 runs ↔ workflows 循环依赖
            from app.modules.runs.service import RunService

            history = RunService.latest_node_outputs(session, wf_id)
            available = dict(history)
            parent_ids = {
                e.get("source") for e in graph.get("edges", []) if e.get("target") == node_id
            }
            merged_upstream = {pid: history[pid] for pid in parent_ids if pid in history}

        executor = build_default_registry().get(node.get("type"))
        if executor is None:
            raise AppError(422, f"No executor for node type '{node.get('type')}'")

        ctx = NodeContext(
            node=node,
            run_inputs=inputs or {},
            upstream=merged_upstream,
            available=available,
            node_names={n["id"]: (n.get("name") or n["id"]) for n in graph.get("nodes", [])},
            providers=get_providers_registry(session),
        )
        started = time.perf_counter()
        result = await executor.execute(ctx)
        return NodeTestResult(
            status=result.status,
            output=result.output,
            error=result.error,
            model=result.model,
            tokens_in=result.tokens_in,
            tokens_out=result.tokens_out,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )

    @staticmethod
    def _validate_dict(graph: dict) -> dict:
        return validate_graph(
            nodes=graph.get("nodes", []),
            edges=graph.get("edges", []),
        )


def _normalize_import_payload(payload: Any) -> list[dict]:
    """兼容三种导入格式：单个工作流 / {workflows:[...]} / 数组。"""
    if isinstance(payload, dict) and isinstance(payload.get("workflows"), list):
        payload = payload["workflows"]
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        raise AppError(422, "导入内容格式不正确")
    entries = [entry for entry in payload if isinstance(entry, dict)]
    if not entries:
        raise AppError(422, "导入内容为空")
    return entries


def _unique_name(name: str, existing: set[str]) -> str:
    if name not in existing:
        return name
    candidate = f"{name} 副本"
    index = 2
    while candidate in existing:
        candidate = f"{name} 副本 {index}"
        index += 1
    return candidate


def _to_response(obj: Any) -> WorkflowResponse:
    graph = json.loads(obj.graph_json)
    viewport = json.loads(obj.viewport_json) if obj.viewport_json else None
    return WorkflowResponse(
        id=obj.id,
        name=obj.name,
        description=obj.description,
        status=obj.status,
        graph=graph,
        viewport=viewport,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
        last_run_at=obj.last_run_at,
    )
