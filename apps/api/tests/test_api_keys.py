"""TRIGGER-01 Phase A：外部 API Key 的创建 / 列表 / 吊销 / 校验。"""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.database import SessionLocal
from app.main import app
from app.modules.auth.models import ApiKey
from app.modules.auth.service import ApiKeyService, create_access_token


def _register(client: TestClient, label: str) -> tuple[str, str, str, str]:
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
    user = data["user"]
    return data["access_token"], data["workspace_id"], user["id"], user["email"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_api_key_lifecycle_and_hash_storage(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    with TestClient(app) as client:
        token, workspace_id, _user_id, _email = _register(client, "api-key")
        headers = _headers(token)

        created = client.post("/api/v1/api-keys", json={"name": "CI"}, headers=headers)
        assert created.status_code == 201, created.text
        data = created.json()["data"]
        raw_key = data["raw_key"]
        assert raw_key.startswith("af_")
        assert data["key_prefix"].startswith("af_")

        listed = client.get("/api/v1/api-keys", headers=headers)
        assert listed.status_code == 200, listed.text
        items = listed.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["key_prefix"] == data["key_prefix"]
        assert "raw_key" not in items[0]

        # 数据库只存 sha256，明文不落库
        with SessionLocal() as session:
            key = session.query(ApiKey).filter(ApiKey.workspace_id == workspace_id).one()
            assert key.key_hash != raw_key
            assert len(key.key_hash) == 64
            assert ApiKeyService.verify(session, raw_key) is not None
            assert ApiKeyService.verify(session, raw_key + "x") is None

        revoked = client.delete(f"/api/v1/api-keys/{data['id']}", headers=headers)
        assert revoked.status_code == 200, revoked.text
        with SessionLocal() as session:
            assert ApiKeyService.verify(session, raw_key) is None


def test_api_key_requires_owner_role(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    with TestClient(app) as client:
        owner_token, workspace_id, _id, _email = _register(client, "api-key-owner")
        _viewer_token, _ws, viewer_id, viewer_email = _register(client, "api-key-viewer")

        invite = client.post(
            f"/api/v1/workspaces/{workspace_id}/members",
            json={"email": viewer_email, "role": "viewer"},
            headers=_headers(owner_token),
        )
        assert invite.status_code == 200, invite.text

        viewer_token = create_access_token(
            user_id=viewer_id,
            email=viewer_email,
            workspace_id=workspace_id,
            role="viewer",
        )
        # 没有 token 时中间件直接 401
        assert client.get("/api/v1/api-keys").status_code == 401
        assert client.get("/api/v1/api-keys", headers=_headers(owner_token)).status_code == 200
        assert client.get("/api/v1/api-keys", headers=_headers(viewer_token)).status_code == 403
