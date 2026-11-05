"""INFRA-02：SaaS 多租户中间件与按 workspace 隔离回归。"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.tenancy import TenantContext, clear_tenant, get_tenant, set_tenant
from app.db.database import SessionLocal
from app.main import app
from app.modules.workflows.models import Workflow

EMPTY_GRAPH = {"version": 1, "inputs": [], "nodes": [], "edges": []}

PASS_THROUGH_GRAPH = {
    "version": 1,
    "inputs": [{"key": "text", "label": "text", "type": "text", "required": False}],
    "nodes": [
        {
            "id": "in",
            "type": "input",
            "name": "输入1",
            "position": {"x": 0, "y": 0},
            "config": {"key": "text"},
        },
        {
            "id": "out",
            "type": "output",
            "name": "输出1",
            "position": {"x": 200, "y": 0},
            "config": {"key": "result"},
        },
    ],
    "edges": [{"id": "e1", "source": "in", "target": "out"}],
}


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
    return data["access_token"], data["refresh_token"], data["workspace_id"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_workflow(client: TestClient, token: str, name: str) -> str:
    response = client.post(
        "/api/v1/workflows",
        headers=_headers(token),
        json={"name": name, "description": "", "graph": EMPTY_GRAPH},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def test_saas_tenant_isolation_and_actor(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)

    with TestClient(app) as client:
        token_a, refresh_a, workspace_a = _register(client, "tenant-a")
        token_b, _refresh_b, workspace_b = _register(client, "tenant-b")
        assert workspace_a != workspace_b

        # 无 token 的 SaaS 请求必须被中间件拦截
        assert client.get("/api/v1/workflows").status_code == 401

        # 健康检查与 CORS 预检应 bypass，不要求 JWT
        assert client.get("/health").status_code == 200
        preflight = client.options(
            "/api/v1/workflows",
            headers={
                "Origin": "http://localhost:5174",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert preflight.status_code != 401

        # refresh token 不能当 access token 使用
        assert client.get("/api/v1/workflows", headers=_headers(refresh_a)).status_code == 401

        workflow_a = _create_workflow(client, token_a, "租户 A 工作流")
        workflow_b = _create_workflow(client, token_b, "租户 B 工作流")

        def workflow_ids(token: str) -> set[str]:
            response = client.get("/api/v1/workflows", headers=_headers(token))
            assert response.status_code == 200, response.text
            return {item["id"] for item in response.json()["data"]["items"]}

        assert workflow_a in workflow_ids(token_a)
        assert workflow_a not in workflow_ids(token_b)
        assert workflow_b in workflow_ids(token_b)
        assert workflow_b not in workflow_ids(token_a)

        # 请求结束后 ContextVar 必须清理
        assert get_tenant() is None

    # 写入时 created_by 来自 TenantContext
    with SessionLocal() as session:
        row_a = session.get(Workflow, workflow_a)
        row_b = session.get(Workflow, workflow_b)
        assert row_a is not None and row_b is not None
        assert str(row_a.workspace_id) == workspace_a
        assert str(row_b.workspace_id) == workspace_b
        assert row_a.created_by is not None
        assert row_b.created_by is not None


def test_saas_provider_settings_run_isolation(monkeypatch) -> None:
    """ADAPT-02/03/04：服务商、设置、运行也都按 workspace 隔离。"""
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)

    with TestClient(app) as client:
        token_a, _refresh_a, _workspace_a = _register(client, "adapt-a")
        token_b, _refresh_b, _workspace_b = _register(client, "adapt-b")

        # ADAPT-03：服务商
        created = client.post(
            "/api/v1/providers",
            headers=_headers(token_a),
            json={
                "kind": "openai-compat",
                "name": "A 的服务商",
                "base_url": "https://api.example.com/v1",
                "api_key": "sk-a",
            },
        )
        assert created.status_code == 200, created.text
        provider_id = created.json()["data"]["id"]

        def provider_ids(token: str) -> set[str]:
            response = client.get("/api/v1/providers", headers=_headers(token))
            assert response.status_code == 200, response.text
            return {item["id"] for item in response.json()["data"]["items"]}

        assert provider_id in provider_ids(token_a)
        assert provider_id not in provider_ids(token_b)

        # ADAPT-04：设置按 workspace 隔离
        updated = client.put(
            "/api/v1/settings", headers=_headers(token_a), json={"language": "en-US"}
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["data"]["language"] == "en-US"
        settings_b = client.get("/api/v1/settings", headers=_headers(token_b))
        assert settings_b.status_code == 200, settings_b.text
        assert settings_b.json()["data"]["language"] == "zh-CN"

        # ADAPT-02：运行记录
        workflow = client.post(
            "/api/v1/workflows",
            headers=_headers(token_a),
            json={"name": "隔离运行", "graph": PASS_THROUGH_GRAPH},
        )
        assert workflow.status_code == 200, workflow.text
        workflow_id = workflow.json()["data"]["id"]
        started = client.post(
            f"/api/v1/workflows/{workflow_id}/runs",
            headers=_headers(token_a),
            json={"inputs": {"text": "hello"}},
        )
        assert started.status_code == 200, started.text
        run_id = started.json()["data"]["id"]

        def run_ids(token: str) -> set[str]:
            response = client.get("/api/v1/runs", headers=_headers(token))
            assert response.status_code == 200, response.text
            return {item["id"] for item in response.json()["data"]["items"]}

        assert run_id in run_ids(token_a)
        assert run_id not in run_ids(token_b)
        assert client.get(f"/api/v1/runs/{run_id}", headers=_headers(token_b)).status_code == 404


def test_session_auto_filters_workspace(monkeypatch) -> None:
    """INFRA-03：没写显式过滤的 ORM 查询在 SaaS 模式下也会自动带上 workspace。"""
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    workspace_a, workspace_b = uuid4(), uuid4()
    wf_a = f"wf_auto_{uuid4().hex[:8]}"
    wf_b = f"wf_auto_{uuid4().hex[:8]}"

    with SessionLocal() as session:
        session.add_all(
            [
                Workflow(
                    id=wf_a,
                    workspace_id=str(workspace_a),
                    name="auto-a",
                    graph_json="{}",
                    status="draft",
                ),
                Workflow(
                    id=wf_b,
                    workspace_id=str(workspace_b),
                    name="auto-b",
                    graph_json="{}",
                    status="draft",
                ),
            ]
        )
        session.commit()

        set_tenant(
            TenantContext(
                workspace_id=workspace_a,
                user_id=uuid4(),
                user_email="auto@example.com",
                role="owner",
            )
        )
        try:
            auto_ids = {wf.id for wf in session.query(Workflow).all()}
            assert wf_a in auto_ids
            assert wf_b not in auto_ids
        finally:
            clear_tenant()

        # 显式绕过：运维/迁移脚本确实需要跨租户读取时才用
        all_ids = {
            wf.id
            for wf in session.query(Workflow).execution_options(include_all_workspaces=True).all()
        }
        assert {wf_a, wf_b} <= all_ids

        session.query(Workflow).filter(Workflow.id.in_([wf_a, wf_b])).delete(
            synchronize_session=False
        )
        session.commit()
