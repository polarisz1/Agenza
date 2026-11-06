"""TRIGGER-01：HTTP / Webhook 触发服务。

- HTTP 触发：`X-API-Key` 认证（Phase B）；
- Webhook：每个触发器独立 secret + HMAC 签名 + 时间窗（Phase C）；
- 两者都只触发**已发布版本**，立即返回 202 + run_id，实际执行交给 Celery 或后台任务。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import KeyManager
from app.core.tenancy import TenantContext, set_tenant
from app.modules.runs.models import Run
from app.modules.runs.repository import RunRepository
from app.modules.runs.service import RunService
from app.modules.triggers.models import WorkflowTrigger
from app.modules.triggers.repository import TriggerRepository, TriggerRequestRepository
from app.modules.triggers.schemas import (
    TriggerRunResponse,
    WebhookTriggerCreate,
    WebhookTriggerCreated,
    WebhookTriggerItem,
    WebhookTriggerListData,
    WebhookTriggerUpdate,
)
from app.modules.workflows.repository import WorkflowRepository
from app.modules.workflows.service import WorkflowService

_MAX_IDEMPOTENCY_KEY = 200
_MAX_WEBHOOK_BODY = 1024 * 1024  # 1 MB
_SIGNATURE_WINDOW_SECONDS = 300
_WEBHOOK_SECRET_PREFIX = "whsec_"

_PATH_TOKEN = re.compile(r"\.([A-Za-z0-9_\-]+)|\[(\d+)\]")


def _response(run: Run, *, deduplicated: bool) -> TriggerRunResponse:
    return TriggerRunResponse(
        run_id=run.id,
        workflow_id=run.workflow_id,
        workflow_name=run.workflow_name,
        status=run.status,
        trigger=run.trigger,
        deduplicated=deduplicated,
    )


def _extract_path(payload, path: str) -> tuple[bool, object]:
    """JSONPath 子集：`$`、`.key`、`[index]`；返回 (是否命中, 值)。"""
    if not path.startswith("$"):
        return False, None
    current = payload
    pos = 1
    for match in _PATH_TOKEN.finditer(path):
        if match.start() != pos:
            return False, None
        key, index = match.groups()
        if key is not None:
            if not isinstance(current, dict) or key not in current:
                return False, None
            current = current[key]
        else:
            idx = int(index)
            if not isinstance(current, list) or idx >= len(current):
                return False, None
            current = current[idx]
        pos = match.end()
    if pos != len(path):
        return False, None
    return True, current


def _map_inputs(mapping: dict[str, str] | None, payload) -> dict:
    if not mapping:
        if not isinstance(payload, dict):
            raise AppError(400, "Webhook 请求体必须是 JSON 对象")
        return payload

    inputs: dict = {}
    for key, path in mapping.items():
        if path.startswith("$"):
            found, value = _extract_path(payload, path)
            if found:
                inputs[key] = value
        else:
            # 非 $ 开头按字面量处理，便于配置固定值
            inputs[key] = path
    return inputs


def _sign(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(
        secret.encode("utf-8"),
        timestamp.encode("utf-8") + b"." + body,
        hashlib.sha256,
    ).hexdigest()


class TriggerService:
    @staticmethod
    def trigger_http(
        session: Session,
        *,
        workspace_id: str,
        user_id: str,
        workflow_id: str,
        inputs: dict,
        background: BackgroundTasks,
        idempotency_key: str | None = None,
    ) -> TriggerRunResponse:
        key = (idempotency_key or "").strip() or None
        if key is not None and len(key) > _MAX_IDEMPOTENCY_KEY:
            raise AppError(400, f"Idempotency-Key 不能超过 {_MAX_IDEMPOTENCY_KEY} 个字符")
        return TriggerService._start_published_run(
            session,
            workflow_id=workflow_id,
            inputs=inputs,
            background=background,
            workspace_id=workspace_id,
            user_id=user_id,
            idempotency_key=key,
        )

    @staticmethod
    def handle_webhook(
        session: Session,
        *,
        trigger_id: str,
        raw_body: bytes,
        timestamp: str | None,
        signature: str | None,
        idempotency_key: str | None,
        background: BackgroundTasks,
    ) -> TriggerRunResponse:
        if len(raw_body) > _MAX_WEBHOOK_BODY:
            raise AppError(413, "Webhook 请求体过大")

        trigger = TriggerRepository.get_public(session, trigger_id)
        if trigger is None:
            raise AppError(404, "Webhook trigger not found")
        if not trigger.enabled:
            raise AppError(403, "Webhook trigger is disabled")

        try:
            secret = KeyManager.decrypt(trigger.secret_enc)
        except Exception as exc:
            raise AppError(403, f"Webhook secret unavailable: {exc}") from exc

        if not timestamp or not signature:
            raise AppError(401, "Missing webhook signature headers")
        try:
            ts_value = int(timestamp)
        except ValueError:
            raise AppError(401, "Invalid webhook timestamp") from None
        if abs(int(time.time()) - ts_value) > _SIGNATURE_WINDOW_SECONDS:
            raise AppError(401, "Webhook timestamp expired")

        provided = signature[7:] if signature.startswith("sha256=") else signature
        expected = _sign(secret, timestamp, raw_body)
        if not hmac.compare_digest(provided, expected):
            raise AppError(401, "Invalid webhook signature")

        # 验签通过后再注入租户上下文；TenantMiddleware 会在请求结束时清理
        set_tenant(
            TenantContext(
                workspace_id=UUID(trigger.workspace_id),
                user_id=UUID(trigger.created_by) if trigger.created_by else UUID(int=0),
                user_email="",
                role="editor",
            )
        )

        try:
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except Exception as exc:
            raise AppError(400, f"Webhook 请求体不是合法 JSON：{exc}") from exc
        try:
            mapping = json.loads(trigger.input_mapping) if trigger.input_mapping else None
        except Exception as exc:
            raise AppError(500, f"触发器输入映射损坏：{exc}") from exc

        inputs = _map_inputs(mapping, payload)

        key = (idempotency_key or "").strip() or None
        if key is not None:
            key = f"{trigger.id}:{key}"
            if len(key) > _MAX_IDEMPOTENCY_KEY:
                raise AppError(400, "Idempotency-Key 过长")

        result = TriggerService._start_published_run(
            session,
            workflow_id=trigger.workflow_id,
            inputs=inputs,
            background=background,
            workspace_id=trigger.workspace_id,
            user_id=str(trigger.created_by) if trigger.created_by else str(UUID(int=0)),
            idempotency_key=key,
        )
        TriggerRepository.touch(session, trigger)
        session.commit()
        return result

    # ---- internal ----

    @staticmethod
    def _start_published_run(
        session: Session,
        *,
        workflow_id: str,
        inputs: dict,
        background: BackgroundTasks,
        workspace_id: str,
        user_id: str,
        idempotency_key: str | None,
    ) -> TriggerRunResponse:
        if idempotency_key is not None:
            existing = TriggerRequestRepository.get(
                session, workflow_id=workflow_id, idempotency_key=idempotency_key
            )
            if existing is not None:
                if not existing.run_id:
                    raise AppError(409, "相同 Idempotency-Key 的请求正在处理中")
                run = RunRepository.get(session, existing.run_id)
                if run is not None:
                    return _response(run, deduplicated=True)

        wf = WorkflowService.get(session, workflow_id)
        if wf is None:
            raise AppError(404, "Workflow not found")
        if not wf.published_version_id:
            raise AppError(409, "工作流尚未发布：请先在编辑器里发布后再触发")

        version = WorkflowRepository.get_version(session, workflow_id, wf.published_version_id)
        if version is None:
            raise AppError(409, "已发布版本不存在：请重新发布工作流")
        try:
            graph = json.loads(version.graph_json)
        except Exception as exc:
            raise AppError(409, f"发布版本图快照损坏：{exc}") from exc

        run = RunService.prepare_run(
            session,
            wf,
            graph,
            inputs or {},
            "api",
            version_id=version.id,
            version_seq=version.seq,
        )

        if idempotency_key is not None:
            try:
                TriggerRequestRepository.create(
                    session,
                    workspace_id=workspace_id,
                    workflow_id=workflow_id,
                    idempotency_key=idempotency_key,
                    run_id=run.id,
                )
                session.commit()
            except IntegrityError:
                # 极窄的并发窗口：另一个请求已写入同一幂等键，返回它对应的运行。
                session.rollback()
                existing = TriggerRequestRepository.get(
                    session, workflow_id=workflow_id, idempotency_key=idempotency_key
                )
                if existing is not None and existing.run_id:
                    existing_run = RunRepository.get(session, existing.run_id)
                    if existing_run is not None:
                        return _response(existing_run, deduplicated=True)
                raise AppError(409, "重复的触发请求，请稍后重试") from None

        if not RunService.dispatch_prepared_run(session, run, graph, inputs or {}):
            background.add_task(
                RunService.execute_run_in_background,
                run.id,
                wf.id,
                graph,
                inputs or {},
                workspace_id,
                user_id,
            )
        return _response(run, deduplicated=False)


# ── Phase C：触发器管理 ───────────────────────────────────────────


def _to_item(trigger: WorkflowTrigger) -> WebhookTriggerItem:
    try:
        mapping = json.loads(trigger.input_mapping) if trigger.input_mapping else None
    except Exception:
        mapping = None
    return WebhookTriggerItem(
        id=trigger.id,
        workflow_id=trigger.workflow_id,
        name=trigger.name,
        enabled=bool(trigger.enabled),
        input_mapping=mapping,
        webhook_path=f"/api/v1/webhooks/{trigger.id}",
        last_triggered_at=trigger.last_triggered_at,
        created_at=trigger.created_at,
    )


def _created(trigger: WorkflowTrigger, secret: str) -> WebhookTriggerCreated:
    item = _to_item(trigger)
    return WebhookTriggerCreated(**item.model_dump(), secret=secret)


def _dump_mapping(mapping: dict[str, str] | None) -> str | None:
    return json.dumps(mapping, ensure_ascii=False) if mapping else None


class TriggerAdminService:
    @staticmethod
    def create(
        session: Session,
        *,
        workspace_id: str,
        body: WebhookTriggerCreate,
    ) -> WebhookTriggerCreated:
        if WorkflowService.get(session, body.workflow_id) is None:
            raise AppError(404, "Workflow not found")
        secret = f"{_WEBHOOK_SECRET_PREFIX}{secrets.token_urlsafe(32)}"
        trigger = TriggerRepository.create(
            session,
            workspace_id=workspace_id,
            workflow_id=body.workflow_id,
            name=body.name,
            secret_enc=KeyManager.encrypt(secret),
            input_mapping=_dump_mapping(body.input_mapping),
            enabled=body.enabled,
        )
        session.commit()
        return _created(trigger, secret)

    @staticmethod
    def list(session: Session, workflow_id: str | None = None) -> WebhookTriggerListData:
        return WebhookTriggerListData(
            items=[_to_item(item) for item in TriggerRepository.list(session, workflow_id)]
        )

    @staticmethod
    def update(
        session: Session,
        trigger_id: str,
        body: WebhookTriggerUpdate,
    ) -> WebhookTriggerItem:
        trigger = TriggerRepository.get(session, trigger_id)
        if trigger is None:
            raise AppError(404, "Webhook trigger not found")
        fields = body.model_dump(exclude_unset=True)
        if "input_mapping" in fields:
            fields["input_mapping"] = _dump_mapping(fields["input_mapping"])
        trigger = TriggerRepository.update(session, trigger, fields)
        session.commit()
        return _to_item(trigger)

    @staticmethod
    def delete(session: Session, trigger_id: str) -> bool:
        trigger = TriggerRepository.get(session, trigger_id)
        if trigger is None:
            return False
        TriggerRepository.delete(session, trigger)
        session.commit()
        return True

    @staticmethod
    def rotate_secret(session: Session, trigger_id: str) -> WebhookTriggerCreated:
        trigger = TriggerRepository.get(session, trigger_id)
        if trigger is None:
            raise AppError(404, "Webhook trigger not found")
        secret = f"{_WEBHOOK_SECRET_PREFIX}{secrets.token_urlsafe(32)}"
        TriggerRepository.update(
            session,
            trigger,
            {"secret_enc": KeyManager.encrypt(secret)},
        )
        session.commit()
        return _created(trigger, secret)
