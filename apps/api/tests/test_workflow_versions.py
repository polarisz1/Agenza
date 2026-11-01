"""F5：工作流版本快照、恢复与运行关联。"""

from __future__ import annotations

import time

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
    "position": {"x": 400, "y": 0},
    "config": {"field": "result"},
}
LLM = {
    "id": "llm",
    "type": "llm",
    "name": "LLM1",
    "position": {"x": 200, "y": 0},
    "config": {"prompt": "hi"},
}

G1 = {
    "version": 1,
    "inputs": [],
    "nodes": [INPUT, OUTPUT],
    "edges": [{"id": "e1", "source": "in", "target": "out"}],
}
G2 = {
    "version": 1,
    "inputs": [],
    "nodes": [INPUT, LLM, OUTPUT],
    "edges": [
        {"id": "e1", "source": "in", "target": "llm"},
        {"id": "e2", "source": "llm", "target": "out"},
    ],
}


def _create(client: TestClient) -> str:
    response = client.post("/api/workflows", json={"name": "版本用例", "graph": G1})
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _versions(client: TestClient, wf_id: str) -> list[dict]:
    response = client.get(f"/api/workflows/{wf_id}/versions")
    assert response.status_code == 200, response.text
    return response.json()["data"]["items"]


def test_version_snapshot_and_restore() -> None:
    with TestClient(app) as client:
        wf_id = _create(client)
        versions = _versions(client, wf_id)
        assert len(versions) == 1
        assert versions[0]["seq"] == 1
        assert versions[0]["summary"] == "初始版本"
        first_id = versions[0]["id"]

        # 只改名字：不产生新版本
        client.put(f"/api/workflows/{wf_id}", json={"name": "改名"})
        assert len(_versions(client, wf_id)) == 1

        # 改图：产生 v2，并带摘要
        updated = client.put(f"/api/workflows/{wf_id}", json={"graph": G2})
        assert updated.status_code == 200, updated.text
        versions = _versions(client, wf_id)
        assert [item["seq"] for item in versions] == [2, 1]
        assert "+1 节点" in versions[0]["summary"]

        # 同一个图再保存：不重复生成
        client.put(f"/api/workflows/{wf_id}", json={"graph": G2})
        assert len(_versions(client, wf_id)) == 2

        # 详情：v1 的图是初始图
        detail = client.get(f"/api/workflows/{wf_id}/versions/{first_id}")
        assert detail.status_code == 200, detail.text
        assert len(detail.json()["data"]["graph"]["nodes"]) == 2

        # 恢复 v1：当前图回到 2 节点，并生成 v3
        restored = client.post(f"/api/workflows/{wf_id}/versions/{first_id}/restore")
        assert restored.status_code == 200, restored.text
        assert len(restored.json()["data"]["graph"]["nodes"]) == 2

        versions = _versions(client, wf_id)
        assert versions[0]["seq"] == 3
        assert versions[0]["summary"] == "恢复到 v1"


def test_run_records_version() -> None:
    with TestClient(app) as client:
        wf_id = _create(client)
        client.put(f"/api/workflows/{wf_id}", json={"graph": G2})

        started = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {}})
        assert started.status_code == 200, started.text
        run_id = started.json()["data"]["id"]

        for _ in range(80):
            detail = client.get(f"/api/runs/{run_id}").json()["data"]
            if detail["status"] != "running":
                break
            time.sleep(0.05)

        assert detail["version_seq"] == 2
        assert detail["version_id"]
