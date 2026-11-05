"""ASYNC-06：审计日志中间件回归。"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

EMPTY_GRAPH = {"version": 1, "inputs": [], "nodes": [], "edges": []}


def _register(client: TestClient, label: str) -> tuple[str, str, str]:
    email = f"{label}-{uuid4().hex[:8]}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "Password123!",
            "name": label,
            "workspace_name": f"{label} Workspace",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["access_token"], email, data["workspace_id"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _audit_items(client: TestClient, token: str) -> list[dict]:
    response = client.get("/api/v1/audit-logs?limit=200", headers=_headers(token))
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_audit_middleware_records_mutations(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)

    with TestClient(app) as client:
        token_a, email_a, workspace_a = _register(client, "audit-a")
        token_b, _email_b, _workspace_b = _register(client, "audit-b")

        # 只读请求不产生审计
        before = len(_audit_items(client, token_a))
        assert client.get("/api/v1/workflows", headers=_headers(token_a)).status_code == 200
        assert len(_audit_items(client, token_a)) == before

        # 创建：中间件记录动作、操作者与归属工作空间
        created = client.post(
            "/api/v1/workflows",
            headers=_headers(token_a),
            json={"name": "审计用例", "description": "", "graph": EMPTY_GRAPH},
        )
        assert created.status_code == 200, created.text
        workflow_id = created.json()["data"]["id"]

        items = _audit_items(client, token_a)
        create_logs = [item for item in items if item["action"] == "workflow.create"]
        assert len(create_logs) == 1
        assert create_logs[0]["user_email"] == email_a
        assert create_logs[0]["workspace_id"] == workspace_a
        assert create_logs[0]["resource_type"] == "workflow"

        # 更新：resource_id 取路径里的工作流 id
        updated = client.put(
            f"/api/v1/workflows/{workflow_id}",
            headers=_headers(token_a),
            json={"name": "审计用例-改名"},
        )
        assert updated.status_code == 200, updated.text
        items = _audit_items(client, token_a)
        update_logs = [item for item in items if item["action"] == "workflow.update"]
        assert update_logs
        assert update_logs[0]["resource_id"] == workflow_id

        # 失败请求（404）不写审计
        count = len(items)
        assert (
            client.put(
                "/api/v1/workflows/wf_not_exist",
                headers=_headers(token_a),
                json={"name": "不存在"},
            ).status_code
            == 404
        )
        assert len(_audit_items(client, token_a)) == count

        # 工作空间隔离：B 看不到 A 的写操作
        actions_b = {item["action"] for item in _audit_items(client, token_b)}
        assert "workflow.create" not in actions_b
        assert "workflow.update" not in actions_b


def test_audit_middleware_scopes_workspace_admin_actions(monkeypatch) -> None:
    """工作空间管理类接口的审计归属取路径里的 workspace。"""
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)

    with TestClient(app) as client:
        token_a, _email_a, workspace_a = _register(client, "audit-admin-a")
        _token_b, email_b, _workspace_b = _register(client, "audit-admin-b")

        invited = client.post(
            f"/api/v1/workspaces/{workspace_a}/members",
            headers=_headers(token_a),
            json={"email": email_b, "role": "editor"},
        )
        assert invited.status_code == 200, invited.text

        items = _audit_items(client, token_a)
        invite_logs = [item for item in items if item["action"] == "workspace.member_invite"]
        assert len(invite_logs) == 1
        assert invite_logs[0]["resource_id"] == workspace_a
        assert invite_logs[0]["workspace_id"] == workspace_a
