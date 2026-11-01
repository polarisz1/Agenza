"""F3：服务商模型列表接口。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.modules.providers import service as providers_service


class FakeAdapter:
    async def list_models(self) -> list[str]:
        return ["model-a", "model-b"]


def _create_provider(client: TestClient) -> str:
    response = client.post(
        "/api/providers",
        json={
            "kind": "openai-compat",
            "name": "模型列表用例",
            "base_url": "https://example.com/v1",
            "api_key": "sk-test",
            "default_model": "model-a",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def test_list_provider_models(monkeypatch) -> None:
    monkeypatch.setattr(providers_service, "_adapter", lambda *args, **kwargs: FakeAdapter())
    with TestClient(app) as client:
        pid = _create_provider(client)
        response = client.get(f"/api/providers/{pid}/models")

    assert response.status_code == 200, response.text
    assert response.json()["data"]["items"] == ["model-a", "model-b"]


def test_list_provider_models_404() -> None:
    with TestClient(app) as client:
        response = client.get("/api/providers/pv_missing/models")

    assert response.status_code == 404
    assert response.json()["message"]
