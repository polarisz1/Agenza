"""B4/D-13：工作流可用性按当前图实时计算。

此前列表里的 status 是"最后一次保存时校验通过"的副作用：API/模板创建的图恒为
draft，运行成功也不会变。现在列表直接返回 issue_count / blocking_count，
界面不再展示不可控的"草稿/就绪"。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

INPUT = {
    "id": "in",
    "type": "input",
    "name": "输入1",
    "position": {"x": 0, "y": 0},
    "config": {"key": "text"},
}
OUTPUT = {
    "id": "out",
    "type": "output",
    "name": "输出1",
    "position": {"x": 200, "y": 0},
    "config": {"field": "result"},
}


def _create(client: TestClient, name: str, nodes: list[dict], edges: list[dict]) -> dict:
    response = client.post(
        "/api/workflows",
        json={
            "name": name,
            "graph": {"version": 1, "inputs": [], "nodes": nodes, "edges": edges},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_create_sets_status_from_graph_validation() -> None:
    with TestClient(app) as client:
        valid = _create(
            client, "可用图", [INPUT, OUTPUT], [{"id": "e", "source": "in", "target": "out"}]
        )
        invalid = _create(client, "缺输出", [INPUT], [])

    assert valid["status"] == "ready"
    assert invalid["status"] == "draft"


def test_list_returns_live_issue_counts() -> None:
    with TestClient(app) as client:
        valid = _create(
            client,
            "计数-可用",
            [INPUT, OUTPUT],
            [{"id": "e1", "source": "in", "target": "out"}],
        )
        invalid = _create(client, "计数-缺输出", [INPUT], [])

        items = client.get("/api/workflows").json()["data"]["items"]

    by_id = {item["id"]: item for item in items}
    assert by_id[valid["id"]]["blocking_count"] == 0
    assert by_id[valid["id"]]["issue_count"] == 0

    # 缺输出节点是一条阻断问题
    assert by_id[invalid["id"]]["blocking_count"] >= 1
    assert by_id[invalid["id"]]["issue_count"] >= 1
