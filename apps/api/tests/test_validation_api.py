"""校验语义的 API 级回归：

- 有阻断问题（缺输出节点 / 未知变量）→ 发起运行返回 422
- 只有提示级问题（孤立节点）→ 仍然允许发起运行
- 校验响应里每条 issue 自带 blocking 标记，前端不再自建阻断码表
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

INPUT_NODE = {
    "id": "i",
    "type": "input",
    "name": "输入",
    "position": {"x": 0, "y": 0},
    "config": {"key": "text"},
}
OUTPUT_NODE = {
    "id": "o",
    "type": "output",
    "name": "输出",
    "position": {"x": 400, "y": 0},
    "config": {"field": "result"},
}
PYTHON_NODE = {
    "id": "p",
    "type": "python",
    "name": "孤立脚本",
    "position": {"x": 0, "y": 300},
    "config": {"script": ""},
}


def _create(client: TestClient, nodes: list[dict], edges: list[dict]) -> str:
    resp = client.post(
        "/api/workflows",
        json={
            "name": "校验用例",
            "graph": {"version": 1, "inputs": [], "nodes": nodes, "edges": edges},
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


def test_missing_output_blocks_run() -> None:
    with TestClient(app) as client:
        wf_id = _create(client, [INPUT_NODE], [])

        can_start = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {}})
        assert can_start.status_code == 422
        assert "Invalid graph" in can_start.text

        checked = client.get(f"/api/workflows/{wf_id}/validate").json()["data"]
        assert checked["ok"] is False
        assert checked["blocking"] is True
        assert all(i["blocking"] for i in checked["issues"] if i["code"] == "MISSING_OUTPUT")


def test_warning_only_graph_still_runs() -> None:
    with TestClient(app) as client:
        wf_id = _create(
            client,
            [INPUT_NODE, OUTPUT_NODE, PYTHON_NODE],
            [{"id": "e1", "source": "i", "target": "o"}],
        )

        checked = client.get(f"/api/workflows/{wf_id}/validate").json()["data"]
        assert checked["ok"] is False, "孤立节点应产生提示"
        assert checked["blocking"] is False, "提示不应阻断"
        assert [i["code"] for i in checked["issues"]] == ["ISOLATED"]
        assert checked["issues"][0]["blocking"] is False

        started = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {"text": "hi"}})
        assert started.status_code == 200, started.text


def test_unknown_field_in_variable_blocks_run() -> None:
    with TestClient(app) as client:
        nodes = [
            INPUT_NODE,
            {**OUTPUT_NODE, "config": {"field": "result", "source": "{{ i.nope }}"}},
        ]
        wf_id = _create(client, nodes, [{"id": "e1", "source": "i", "target": "o"}])

        checked = client.get(f"/api/workflows/{wf_id}/validate").json()["data"]
        assert checked["blocking"] is True
        issue = next(i for i in checked["issues"] if i["code"] == "UNKNOWN_FIELD")
        assert issue["blocking"] is True
        assert "nope" in issue["message"]

        resp = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {}})
        assert resp.status_code == 422
