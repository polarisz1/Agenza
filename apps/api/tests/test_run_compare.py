"""F1：运行对比（同工作流、按 node_id 对齐）与运行输入回看。"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

SCRIPT = (
    "import json\n"
    "from pathlib import Path\n"
    'data = json.loads(Path("input.json").read_text(encoding="utf-8"))\n'
    'text = data["inputs"].get("text", "")\n'
    'agentflow_result = {"length": len(text), "upper": text.upper()}\n'
)

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
            "id": "py",
            "type": "python",
            "name": "脚本1",
            "position": {"x": 200, "y": 0},
            "config": {"script": SCRIPT},
        },
        {
            "id": "out",
            "type": "output",
            "name": "输出1",
            "position": {"x": 400, "y": 0},
            "config": {"field": "result", "source": "{{ 脚本1 }}"},
        },
    ],
    "edges": [
        {"id": "e1", "source": "in", "target": "py"},
        {"id": "e2", "source": "py", "target": "out"},
    ],
}


def _wait(client: TestClient, run_id: str, timeout: float = 8.0) -> dict:
    deadline = time.time() + timeout
    detail: dict = {}
    while time.time() < deadline:
        detail = client.get(f"/api/runs/{run_id}").json()["data"]
        if detail["status"] != "running":
            return detail
        time.sleep(0.05)
    pytest.fail(f"run {run_id} did not finish: {detail.get('status')}")


def _create(client: TestClient, name: str) -> str:
    response = client.post("/api/workflows", json={"name": name, "graph": GRAPH})
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _run(client: TestClient, workflow_id: str, text: str) -> dict:
    response = client.post(f"/api/workflows/{workflow_id}/runs", json={"inputs": {"text": text}})
    assert response.status_code == 200, response.text
    return _wait(client, response.json()["data"]["id"])


def test_compare_aligns_nodes_and_keeps_inputs() -> None:
    with TestClient(app) as client:
        workflow_id = _create(client, "对比用例")
        first = _run(client, workflow_id, "abcd")
        second = _run(client, workflow_id, "xyz")

        response = client.get(f"/api/runs/compare?ids={first['id']},{second['id']}")

    assert response.status_code == 200, response.text
    data = response.json()["data"]

    # 运行输入可回看（F1）
    assert data["a"]["inputs"] == {"text": "abcd"}
    assert data["b"]["inputs"] == {"text": "xyz"}

    nodes = {node["node_id"]: node for node in data["nodes"]}
    assert set(nodes) == {"in", "py", "out"}
    assert nodes["py"]["a"]["output"] == {"length": 4, "upper": "ABCD"}
    assert nodes["py"]["b"]["output"] == {"length": 3, "upper": "XYZ"}
    assert nodes["py"]["a"]["status"] == nodes["py"]["b"]["status"] == "success"


def test_compare_rejects_cross_workflow_and_bad_ids() -> None:
    with TestClient(app) as client:
        first_wf = _create(client, "对比-A")
        second_wf = _create(client, "对比-B")
        first = _run(client, first_wf, "a")
        second = _run(client, second_wf, "b")

        cross = client.get(f"/api/runs/compare?ids={first['id']},{second['id']}")
        missing = client.get(f"/api/runs/compare?ids={first['id']},r_missing")
        malformed = client.get(f"/api/runs/compare?ids={first['id']}")

    assert cross.status_code == 422
    assert missing.status_code == 404
    assert malformed.status_code == 400
