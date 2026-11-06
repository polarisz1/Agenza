"""TRIGGER-01 Phase B：HTTP 触发（API Key / 发布门禁 / 202 异步 / 幂等 / 租户隔离）。"""

from __future__ import annotations

import time
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.database import SessionLocal
from app.main import app
from app.modules.auth.models import ApiKey
from app.modules.runs.models import NodeRun, Run
from app.modules.triggers.models import TriggerRequest
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


def _graph(required: bool = True) -> dict:
    return {
        "version": 1,
        "inputs": [{"key": "topic", "label": "主题", "type": "text", "required": required}],
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


def _create_workflow(client: TestClient, headers: dict, name: str) -> str:
    response = client.post(
        "/api/v1/workflows",
        json={"name": name, "graph": _graph()},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _publish(client: TestClient, headers: dict, workflow_id: str) -> None:
    response = client.post(f"/api/v1/workflows/{workflow_id}/publish", headers=headers)
    assert response.status_code == 200, response.text


def _create_key(client: TestClient, headers: dict) -> tuple[str, str]:
    response = client.post(
        "/api/v1/api-keys",
        json={"name": "CI"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    data = response.json()["data"]
    return data["raw_key"], data["id"]


def _trigger(
    client: TestClient,
    workflow_id: str,
    raw_key: str,
    inputs: dict,
    idempotency_key: str | None = None,
):
    headers = {"X-API-Key": raw_key}
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return client.post(
        f"/api/v1/triggers/http/{workflow_id}",
        json={"inputs": inputs},
        headers=headers,
    )


def _wait_run(client: TestClient, headers: dict, run_id: str) -> dict:
    for _ in range(100):
        response = client.get(f"/api/v1/runs/{run_id}", headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        if data["status"] != "running":
            return data
        time.sleep(0.1)
    raise AssertionError(f"run {run_id} did not finish")


def _cleanup(workflow_ids: list[str], key_ids: list[str]) -> None:
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
        session.query(WorkflowVersion).filter(WorkflowVersion.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(Workflow).filter(Workflow.id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        if key_ids:
            session.query(ApiKey).filter(ApiKey.id.in_(key_ids)).delete(synchronize_session=False)
        session.commit()


def test_http_trigger_full_flow(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    workflow_ids: list[str] = []
    key_ids: list[str] = []
    with TestClient(app) as client:
        token, _ws = _register(client, "trigger")
        headers = _headers(token)
        workflow_id = _create_workflow(client, headers, "HTTP 触发用例")
        workflow_ids.append(workflow_id)
        raw_key, key_id = _create_key(client, headers)
        key_ids.append(key_id)

        # 未发布 → 409
        unpublished = _trigger(client, workflow_id, raw_key, {"topic": "x"})
        assert unpublished.status_code == 409, unpublished.text

        _publish(client, headers, workflow_id)

        # 缺少鉴权 → 401；错误 Key → 401
        assert (
            client.post(
                f"/api/v1/triggers/http/{workflow_id}", json={"inputs": {"topic": "x"}}
            ).status_code
            == 401
        )
        assert _trigger(client, workflow_id, "af_bad_key", {"topic": "x"}).status_code == 401

        # 必填输入缺失 → 400
        missing = _trigger(client, workflow_id, raw_key, {})
        assert missing.status_code == 400, missing.text

        # 正常触发 → 202 + run_id，最终成功且 trigger=api
        created = _trigger(client, workflow_id, raw_key, {"topic": "x"})
        assert created.status_code == 202, created.text
        body = created.json()
        assert body["code"] == 202
        run_id = body["data"]["run_id"]
        assert body["data"]["deduplicated"] is False

        run = _wait_run(client, headers, run_id)
        assert run["status"] == "success", run
        assert run["trigger"] == "api"
        assert run["version_seq"] == 1

        # 幂等：相同 Idempotency-Key 返回同一个 run，不再新建
        first = _trigger(client, workflow_id, raw_key, {"topic": "y"}, "idem-1")
        assert first.status_code == 202, first.text
        first_id = first.json()["data"]["run_id"]

        second = _trigger(client, workflow_id, raw_key, {"topic": "y"}, "idem-1")
        assert second.status_code == 202, second.text
        assert second.json()["data"]["run_id"] == first_id
        assert second.json()["data"]["deduplicated"] is True

    _cleanup(workflow_ids, key_ids)


def test_http_trigger_is_workspace_scoped(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    workflow_ids: list[str] = []
    key_ids: list[str] = []
    with TestClient(app) as client:
        token_a, _ws_a = _register(client, "trigger-a")
        headers_a = _headers(token_a)
        raw_key_a, key_a = _create_key(client, headers_a)
        key_ids.append(key_a)

        token_b, _ws_b = _register(client, "trigger-b")
        headers_b = _headers(token_b)
        workflow_b = _create_workflow(client, headers_b, "B 的工作流")
        workflow_ids.append(workflow_b)
        _publish(client, headers_b, workflow_b)

        # A 的 Key 不能触发 B 的工作流
        forbidden = _trigger(client, workflow_b, raw_key_a, {"topic": "x"})
        assert forbidden.status_code == 404, forbidden.text

    _cleanup(workflow_ids, key_ids)
