"""ASYNC-05：工作流发布（Draft → Ready → Published）回归。"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

GRAPH = {
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

EMPTY_GRAPH = {"version": 1, "inputs": [], "nodes": [], "edges": []}


def _create(client: TestClient) -> str:
    response = client.post(
        "/api/workflows",
        json={"name": "发布用例", "description": "", "graph": GRAPH},
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _versions(client: TestClient, wf_id: str) -> list[dict]:
    response = client.get(f"/api/workflows/{wf_id}/versions")
    assert response.status_code == 200, response.text
    return response.json()["data"]["items"]


def test_publish_current_and_unpublish() -> None:
    with TestClient(app) as client:
        wf_id = _create(client)

        published = client.post(f"/api/workflows/{wf_id}/publish")
        assert published.status_code == 200, published.text
        data = published.json()["data"]
        assert data["published_at"] is not None
        assert data["published_version_id"] is not None
        assert data["has_unpublished_changes"] is False

        # 发布后改图：不应清掉发布标记，但会标记"有未发布修改"
        changed = dict(GRAPH)
        changed["nodes"] = [dict(node) for node in GRAPH["nodes"]]
        changed["nodes"][0]["name"] = "输入2"
        updated = client.put(f"/api/workflows/{wf_id}", json={"graph": changed})
        assert updated.status_code == 200, updated.text
        assert updated.json()["data"]["published_version_id"] == data["published_version_id"]
        assert updated.json()["data"]["has_unpublished_changes"] is True

        # 列表同样带发布信息
        listed = client.get("/api/workflows").json()["data"]["items"]
        item = next(entry for entry in listed if entry["id"] == wf_id)
        assert item["published_at"] is not None
        assert item["has_unpublished_changes"] is True

        unpublished = client.post(f"/api/workflows/{wf_id}/unpublish")
        assert unpublished.status_code == 200, unpublished.text
        assert unpublished.json()["data"]["published_at"] is None
        assert unpublished.json()["data"]["published_version_id"] is None


def test_publish_specific_version_keeps_current_graph() -> None:
    with TestClient(app) as client:
        wf_id = _create(client)
        v1 = _versions(client, wf_id)[0]

        # 第二次保存生成新版本，但不自动发布
        changed = dict(GRAPH)
        changed["nodes"] = [dict(node) for node in GRAPH["nodes"]]
        changed["nodes"][0]["name"] = "输入2"
        saved = client.put(f"/api/workflows/{wf_id}", json={"graph": changed})
        assert saved.status_code == 200, saved.text
        assert saved.json()["data"]["published_at"] is None
        versions = _versions(client, wf_id)
        assert len(versions) == 2

        # 发布历史版本：发布标记指向该版本，当前画布保持最新内容
        published = client.post(f"/api/workflows/{wf_id}/publish", json={"version_id": v1["id"]})
        assert published.status_code == 200, published.text
        data = published.json()["data"]
        assert data["published_version_id"] == v1["id"]
        assert data["has_unpublished_changes"] is True
        assert data["graph"]["nodes"][0]["name"] == "输入2"


def test_publish_rejects_blocking_graph() -> None:
    with TestClient(app) as client:
        wf_id = _create(client)
        saved = client.put(f"/api/workflows/{wf_id}", json={"graph": EMPTY_GRAPH})
        assert saved.status_code == 200, saved.text

        response = client.post(f"/api/workflows/{wf_id}/publish")
        assert response.status_code == 422, response.text

        # 未知工作流 / 未知版本
        assert client.post("/api/workflows/wf_missing/publish").status_code == 404
        assert (
            client.post(
                f"/api/workflows/{wf_id}/publish", json={"version_id": "wv_missing"}
            ).status_code
            == 404
        )
