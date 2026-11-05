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
from app.modules.providers.service import build_registry
from app.modules.workflows.models import WorkflowVersion
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
    WorkflowVersionDetail,
    WorkflowVersionItem,
)


class WorkflowService:
    @staticmethod
    def create(session: Session, body: WorkflowCreate) -> WorkflowResponse:
        wf_id = f"wf_{uuid.uuid4().hex[:10]}"
        # 创建时就按图算一次状态：API/模板创建的工作流不再是"永远草稿"（D-13 的兼容处理）
        validation = WorkflowService._validate_dict(body.graph.model_dump())
        obj = WorkflowRepository.create(
            session,
            wf_id=wf_id,
            name=body.name,
            description=body.description,
            graph_json=body.graph.model_dump_json(),
            status="draft" if validation["blocking"] else "ready",
        )
        WorkflowService._create_version(
            session, wf_id, body.graph.model_dump_json(), None, "初始版本"
        )

        # 审计日志由 AuditMiddleware 统一记录（ASYNC-06），这里不再手动写
        session.commit()
        return _response(session, obj)

    @staticmethod
    def get(session: Session, wf_id: str) -> WorkflowResponse | None:
        obj = WorkflowRepository.get(session, wf_id)
        if not obj:
            return None
        return _response(session, obj)

    @staticmethod
    def list(
        session: Session,
        q: str | None = None,
        status: str | None = None,
        sort: str = "updated_desc",
    ) -> list[WorkflowListItem]:
        objs, _ = WorkflowRepository.list(session, q=q, status=status, sort=sort)
        latest_ids = WorkflowRepository.latest_version_ids(session, [obj.id for obj in objs])
        out = []
        for obj in objs:
            try:
                graph = json.loads(obj.graph_json)
                node_count = len(graph.get("nodes", []))
            except Exception:
                graph = {}
                node_count = 0

            # 可用性按**当前图**实时计算（D-13）：不再依赖最后一次保存时的 status
            try:
                validation = WorkflowService._validate_dict(graph)
                issue_count = len(validation["issues"])
                blocking_count = sum(1 for issue in validation["issues"] if issue["blocking"])
            except Exception:
                issue_count = 0
                blocking_count = 0

            out.append(
                WorkflowListItem(
                    id=obj.id,
                    name=obj.name,
                    description=obj.description,
                    status=obj.status,
                    issue_count=issue_count,
                    blocking_count=blocking_count,
                    node_count=node_count,
                    last_run_at=obj.last_run_at,
                    updated_at=obj.updated_at,
                    published_version_id=obj.published_version_id,
                    published_at=obj.published_at,
                    has_unpublished_changes=_has_unpublished_changes(obj, latest_ids.get(obj.id)),
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

        # Auto-set status：没有阻断问题时才算"已就绪"（提示级问题不影响可运行）
        new_status = None
        if body.graph is not None:
            result = WorkflowService._validate_dict(body.graph.model_dump())
            new_status = "draft" if result["blocking"] else "ready"

        # F5：图内容真的变了才生成版本快照
        version_summary: str | None = None
        if body.graph is not None:
            try:
                old_graph = json.loads(obj.graph_json) if obj.graph_json else {}
            except Exception:
                old_graph = {}
            new_graph = body.graph.model_dump()
            if old_graph != new_graph:
                version_summary = _diff_summary(old_graph, new_graph)

        updated = WorkflowRepository.update(
            session,
            wf_id,
            name=body.name,
            description=body.description,
            graph_json=graph_json,
            viewport_json=viewport_json,
            status=body.status or new_status,
        )
        if version_summary is not None and updated is not None:
            WorkflowService._create_version(
                session,
                wf_id,
                updated.graph_json,
                updated.viewport_json,
                version_summary,
            )
        session.commit()
        return _response(session, updated) if updated else None

    # ---- 版本历史（F5） ----

    @staticmethod
    def _create_version(
        session: Session,
        wf_id: str,
        graph_json: str,
        viewport_json: str | None,
        summary: str,
    ) -> WorkflowVersion:
        latest = WorkflowRepository.latest_version(session, wf_id)
        seq = (latest.seq + 1) if latest else 1
        version = WorkflowRepository.create_version(
            session,
            WorkflowVersion(
                id=f"wv_{uuid.uuid4().hex[:10]}",
                workflow_id=wf_id,
                seq=seq,
                summary=summary[:200],
                graph_json=graph_json,
                viewport_json=viewport_json,
            ),
        )
        WorkflowRepository.prune_versions(session, wf_id, keep=50)
        return version

    @staticmethod
    def list_versions(session: Session, wf_id: str) -> list[WorkflowVersionItem]:
        return [
            _to_version_item(version)
            for version in WorkflowRepository.list_versions(session, wf_id)
        ]

    @staticmethod
    def get_version(session: Session, wf_id: str, version_id: str) -> WorkflowVersionDetail | None:
        version = WorkflowRepository.get_version(session, wf_id, version_id)
        if version is None:
            return None
        graph = json.loads(version.graph_json)
        viewport = json.loads(version.viewport_json) if version.viewport_json else None
        item = _to_version_item(version)
        return WorkflowVersionDetail(
            **item.model_dump(),
            graph=graph,
            viewport=viewport,
        )

    @staticmethod
    def restore_version(session: Session, wf_id: str, version_id: str) -> WorkflowResponse | None:
        obj = WorkflowRepository.get(session, wf_id)
        if obj is None:
            return None
        version = WorkflowRepository.get_version(session, wf_id, version_id)
        if version is None:
            return None

        graph = json.loads(version.graph_json)
        validation = WorkflowService._validate_dict(graph)
        updated = WorkflowRepository.update(
            session,
            wf_id,
            graph_json=version.graph_json,
            viewport_json=version.viewport_json,
            status="draft" if validation["blocking"] else "ready",
        )
        if updated is None:
            return None
        WorkflowService._create_version(
            session,
            wf_id,
            version.graph_json,
            version.viewport_json,
            f"恢复到 v{version.seq}",
        )
        session.commit()
        return _response(session, updated)

    @staticmethod
    def publish(
        session: Session, wf_id: str, version_id: str | None = None
    ) -> WorkflowResponse | None:
        """发布工作流（ASYNC-05）。

        - 不传 `version_id`：校验当前图并发布当前内容（必要时生成版本快照）；
        - 传 `version_id`：发布指定历史版本，不改动当前画布。
        """
        obj = WorkflowRepository.get(session, wf_id)
        if obj is None:
            return None

        version = None
        if version_id:
            version = WorkflowRepository.get_version(session, wf_id, version_id)
            if version is None:
                raise AppError(404, "版本不存在")
            graph = json.loads(version.graph_json)
        else:
            graph = json.loads(obj.graph_json)

        if WorkflowService._validate_dict(graph)["blocking"]:
            raise AppError(422, "当前配置存在阻断问题，无法发布")

        if version is not None:
            target = version
        else:
            latest = WorkflowRepository.latest_version(session, wf_id)
            target = (
                latest
                if latest is not None and latest.graph_json == obj.graph_json
                else WorkflowService._create_version(
                    session,
                    wf_id,
                    obj.graph_json,
                    obj.viewport_json,
                    "发布当前版本",
                )
            )

        published = WorkflowRepository.set_published(session, wf_id, target.id)
        session.commit()
        return _response(session, published) if published is not None else None

    @staticmethod
    def unpublish(session: Session, wf_id: str) -> WorkflowResponse | None:
        obj = WorkflowRepository.set_published(session, wf_id, None)
        if obj is None:
            return None
        session.commit()
        return _response(session, obj)

    @staticmethod
    def latest_version(session: Session, wf_id: str) -> tuple[str, int] | None:
        """给运行记录关联版本用（F5）。"""
        version = WorkflowRepository.latest_version(session, wf_id)
        return (version.id, version.seq) if version else None

    @staticmethod
    def count(session: Session) -> int:
        return len(WorkflowRepository.list(session)[0])

    @staticmethod
    def delete(session: Session, wf_id: str) -> bool:
        ok = WorkflowRepository.delete(session, wf_id)
        session.commit()
        return ok

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
        # 建副本 + 复制视口是两步写，必须在同一事务里提交
        session.commit()
        return DuplicateResult(id=dup_obj.id, name=dup_obj.name)

    @staticmethod
    def validate(session: Session, graph: GraphDef) -> ValidateResult:
        result = WorkflowService._validate_dict(graph.model_dump())
        return ValidateResult(ok=result["ok"], blocking=result["blocking"], issues=result["issues"])

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

        # 导入可能是多条记录：一次性提交，避免中途失败留下半套数据
        if created_ids:
            session.commit()
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

        registry = build_registry(session)
        # GATE-01：单节点调试同样遵守路由策略与预算硬停机
        from app.modules.gateway.service import GatewayService

        gateway = GatewayService.build_runtime(session, registry)

        ctx = NodeContext(
            node=node,
            run_inputs=inputs or {},
            upstream=merged_upstream,
            available=available,
            node_names={n["id"]: (n.get("name") or n["id"]) for n in graph.get("nodes", [])},
            providers=registry,
            model_router=gateway.router,
            budget_exhausted=gateway.budget_exhausted,
            budget_message=gateway.budget_message,
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


def _has_unpublished_changes(obj: Any, latest_version_id: str | None) -> bool:
    """已发布，且最新版本不是被发布的那一版（保存或发布旧版本都会命中）。"""
    published_version_id = getattr(obj, "published_version_id", None)
    return bool(published_version_id and published_version_id != latest_version_id)


def _response(session: Session, obj: Any) -> WorkflowResponse:
    """单条响应：额外查一次最新版本，用于计算是否有未发布修改。"""
    latest = WorkflowRepository.latest_version(session, obj.id)
    return _to_response(obj, latest.id if latest else None)


def _to_response(obj: Any, latest_version_id: str | None = None) -> WorkflowResponse:
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
        published_version_id=obj.published_version_id,
        published_at=obj.published_at,
        has_unpublished_changes=_has_unpublished_changes(obj, latest_version_id),
    )


def _to_version_item(version: WorkflowVersion) -> WorkflowVersionItem:
    try:
        graph = json.loads(version.graph_json)
        node_count = len(graph.get("nodes", []))
    except Exception:
        node_count = 0
    return WorkflowVersionItem(
        id=version.id,
        seq=version.seq,
        summary=version.summary or "",
        node_count=node_count,
        created_at=version.created_at,
    )


def _diff_summary(old_graph: dict, new_graph: dict) -> str:
    """给版本列表生成一句可读的变更摘要（节点/连线增删数量）。"""
    old_nodes = {node.get("id") for node in old_graph.get("nodes", [])}
    new_nodes = {node.get("id") for node in new_graph.get("nodes", [])}
    old_edges = {edge.get("id") for edge in old_graph.get("edges", [])}
    new_edges = {edge.get("id") for edge in new_graph.get("edges", [])}

    parts: list[str] = []
    added, removed = len(new_nodes - old_nodes), len(old_nodes - new_nodes)
    if added:
        parts.append(f"+{added} 节点")
    if removed:
        parts.append(f"-{removed} 节点")
    edge_added, edge_removed = len(new_edges - old_edges), len(old_edges - new_edges)
    if edge_added:
        parts.append(f"+{edge_added} 连线")
    if edge_removed:
        parts.append(f"-{edge_removed} 连线")

    return " / ".join(parts) if parts else "配置更新"
