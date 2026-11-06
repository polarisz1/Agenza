"""TRIGGER-01 Phase C：Webhook（HMAC 验签 / 时间窗 / 输入映射 / 幂等 / 轮换）。"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.database import SessionLocal
from app.main import app
from app.modules.runs.models import NodeRun, Run
from app.modules.triggers.models import TriggerRequest, WorkflowTrigger
from app.modules.workflows.models import Workflow, WorkflowVersion


def _register(client: TestClient, label: str) -> tuple[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"{label}-{uuid4().hex[:8]}@example.com",
            "password": "Password123!",
            "name": label,
            "workspace_name": f"{label} Workspace",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["access_token"], data["workspace_id"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _graph() -> dict:
    return {
        "version": 1,
        "inputs": [{"key": "topic", "label": "主题", "type": "text", "required": True}],
        "nodes": [
            {
                "id": "n_in",
                "name": "开始",
                "type": "input",
                "position": {"x": 0, "y": 0},
                "config": {"key": "topic", "data_type": "text"},
            },
            {
                "id": "n_py",
                "name": "脚本",
                "type": "python",
                "position": {"x": 240, "y": 0},
                "config": {"script": "agentflow_result = 'ok'"},
            },
            {
                "id": "n_out",
                "name": "输出",
                "type": "output",
                "position": {"x": 480, "y": 0},
                "config": {"field": "result", "source": ""},
            },
        ],
        "edges": [
            {"id": "e1", "source": "n_in", "target": "n_py"},
            {"id": "e2", "source": "n_py", "target": "n_out"},
        ],
    }


def _create_published_workflow(client: TestClient, headers: dict) -> str:
    response = client.post(
        "/api/v1/workflows",
        json={"name": "Webhook 用例", "graph": _graph()},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    workflow_id = response.json()["data"]["id"]
    published = client.post(f"/api/v1/workflows/{workflow_id}/publish", headers=headers)
    assert published.status_code == 200, published.text
    return workflow_id


def _sign(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(
        secret.encode(),
        timestamp.encode() + b"." + body,
        hashlib.sha256,
    ).hexdigest()


def _post_webhook(
    client: TestClient,
    trigger_id: str,
    secret: str,
    payload: dict,
    *,
    timestamp: str | None = None,
    idempotency_key: str | None = None,
    signature_override: str | None = None,
):
    raw = json.dumps(payload, ensure_ascii=False).encode()
    ts = timestamp or str(int(time.time()))
    signature = signature_override or f"sha256={_sign(secret, ts, raw)}"
    headers = {
        "X-AgentFlow-Timestamp": ts,
        "X-AgentFlow-Signature": signature,
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["X-Idempotency-Key"] = idempotency_key
    return client.post(f"/api/v1/webhooks/{trigger_id}", content=raw, headers=headers)


def _wait_run(client: TestClient, headers: dict, run_id: str) -> dict:
    for _ in range(100):
        response = client.get(f"/api/v1/runs/{run_id}", headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        if data["status"] != "running":
            return data
        time.sleep(0.1)
    raise AssertionError(f"run {run_id} did not finish")


def _cleanup(workflow_ids: list[str]) -> None:
    with SessionLocal() as session:
        run_ids = [
            row[0] for row in session.query(Run.id).filter(Run.workflow_id.in_(workflow_ids))
        ]
        if run_ids:
            session.query(NodeRun).filter(NodeRun.run_id.in_(run_ids)).delete(
                synchronize_session=False
            )
        session.query(TriggerRequest).filter(TriggerRequest.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(Run).filter(Run.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(WorkflowTrigger).filter(WorkflowTrigger.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(WorkflowVersion).filter(WorkflowVersion.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(Workflow).filter(Workflow.id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.commit()


def test_webhook_end_to_end(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    workflow_ids: list[str] = []
    with TestClient(app) as client:
        token, _ws = _register(client, "webhook")
        headers = _headers(token)
        workflow_id = _create_published_workflow(client, headers)
        workflow_ids.append(workflow_id)

        created = client.post(
            "/api/v1/triggers",
            json={
                "workflow_id": workflow_id,
                "name": "GitHub Push",
                "input_mapping": {"topic": "$.data.topic"},
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text
        trigger = created.json()["data"]
        trigger_id = trigger["id"]
        secret = trigger["secret"]
        assert secret.startswith("whsec_")

        # 列表不返回 secret
        listed = client.get("/api/v1/triggers", headers=headers)
        items = listed.json()["data"]["items"]
        assert len(items) == 1
        assert "secret" not in items[0]
        assert items[0]["webhook_path"] == f"/api/v1/webhooks/{trigger_id}"

        # 正常投递：映射 $.data.topic → inputs.topic
        delivered = _post_webhook(
            client,
            trigger_id,
            secret,
            {"data": {"topic": "hello"}},
            idempotency_key="delivery-1",
        )
        assert delivered.status_code == 202, delivered.text
        run_id = delivered.json()["data"]["run_id"]
        run = _wait_run(client, headers, run_id)
        assert run["status"] == "success", run
        assert run["trigger"] == "api"
        assert run["inputs"]["topic"] == "hello"

        # 同一投递 ID 幂等
        again = _post_webhook(
            client,
            trigger_id,
            secret,
            {"data": {"topic": "hello"}},
            idempotency_key="delivery-1",
        )
        assert again.json()["data"]["run_id"] == run_id
        assert again.json()["data"]["deduplicated"] is True

        # 签名错误 / 时间窗过期 / 未知触发器
        assert (
            _post_webhook(
                client,
                trigger_id,
                secret,
                {"data": {"topic": "x"}},
                signature_override="sha256=bad",
            ).status_code
            == 401
        )
        assert (
            _post_webhook(
                client,
                trigger_id,
                secret,
                {"data": {"topic": "x"}},
                timestamp=str(int(time.time()) - 600),
            ).status_code
            == 401
        )
        assert _post_webhook(client, "trg_missing", secret, {}).status_code == 404

        # 禁用后拒绝
        patched = client.patch(
            f"/api/v1/triggers/{trigger_id}",
            json={"enabled": False},
            headers=headers,
        )
        assert patched.status_code == 200, patched.text
        assert (
            _post_webhook(client, trigger_id, secret, {"data": {"topic": "x"}}).status_code == 403
        )
        client.patch(
            f"/api/v1/triggers/{trigger_id}",
            json={"enabled": True},
            headers=headers,
        )

        # 轮换 secret：旧签名失效，新签名可用
        rotated = client.post(f"/api/v1/triggers/{trigger_id}/rotate-secret", headers=headers)
        assert rotated.status_code == 200, rotated.text
        new_secret = rotated.json()["data"]["secret"]
        assert new_secret != secret
        assert (
            _post_webhook(client, trigger_id, secret, {"data": {"topic": "old"}}).status_code == 401
        )
        assert (
            _post_webhook(client, trigger_id, new_secret, {"data": {"topic": "new"}}).status_code
            == 202
        )

        # 删除后公网入口不可用
        deleted = client.delete(f"/api/v1/triggers/{trigger_id}", headers=headers)
        assert deleted.status_code == 200, deleted.text
        assert (
            _post_webhook(client, trigger_id, new_secret, {"data": {"topic": "x"}}).status_code
            == 404
        )

    _cleanup(workflow_ids)


def test_webhook_requires_signature(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    workflow_ids: list[str] = []
    with TestClient(app) as client:
        token, _ws = _register(client, "webhook-sig")
        headers = _headers(token)
        workflow_id = _create_published_workflow(client, headers)
        workflow_ids.append(workflow_id)
        created = client.post(
            "/api/v1/triggers",
            json={"workflow_id": workflow_id, "name": "No signature"},
            headers=headers,
        )
        trigger_id = created.json()["data"]["id"]

        response = client.post(f"/api/v1/webhooks/{trigger_id}", json={"topic": "x"})
        assert response.status_code == 401

    _cleanup(workflow_ids)
