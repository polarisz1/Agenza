"""运行链路端到端：条件分支图经真实引擎执行，结果落到 run/node_run。

这是 B1（条件分支只有判定没有分流）的回归用例：真分支执行、假分支 skipped 且原因落库，
并检查 SSE 回放里带同样的原因（前端运行抽屉直接展示 error 字段）。
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

GRAPH = {
    "version": 1,
    "inputs": [{"key": "a", "label": "a", "type": "text", "required": True}],
    "nodes": [
        {
            "id": "in",
            "type": "input",
            "name": "输入",
            "position": {"x": 0, "y": 0},
            "config": {"key": "a"},
        },
        {
            "id": "c",
            "type": "condition",
            "name": "判断",
            "position": {"x": 200, "y": 0},
            "config": {"left": "{{ 输入.a }}", "op": "eq", "right": "1"},
        },
        {
            "id": "o_true",
            "type": "output",
            "name": "真输出",
            "position": {"x": 400, "y": -80},
            "config": {"field": "result"},
        },
        {
            "id": "o_false",
            "type": "output",
            "name": "假输出",
            "position": {"x": 400, "y": 80},
            "config": {"field": "result"},
        },
    ],
    "edges": [
        {"id": "e1", "source": "in", "target": "c"},
        {"id": "e2", "source": "c", "target": "o_true", "from_port": "true"},
        {"id": "e3", "source": "c", "target": "o_false", "from_port": "false"},
    ],
}


def _wait(client: TestClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    detail: dict = {}
    while time.time() < deadline:
        detail = client.get(f"/api/runs/{run_id}").json()["data"]
        if detail["status"] != "running":
            return detail
        time.sleep(0.05)
    pytest.fail(f"run {run_id} did not finish: {detail.get('status')}")


def test_condition_run_executes_only_active_branch() -> None:
    with TestClient(app) as client:
        wf = client.post("/api/workflows", json={"name": "T3 分支", "graph": GRAPH})
        assert wf.status_code == 200, wf.text
        wf_id = wf.json()["data"]["id"]

        started = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {"a": "1"}})
        assert started.status_code == 200, started.text
        run_id = started.json()["data"]["id"]

        detail = _wait(client, run_id)
        nodes = {n["node_id"]: n for n in detail["nodes"]}

        assert detail["status"] == "success"
        assert nodes["in"]["status"] == "success"
        assert nodes["c"]["status"] == "success"
        assert nodes["o_true"]["status"] == "success"
        assert nodes["o_false"]["status"] == "skipped"
        assert "分支未激活" in (nodes["o_false"]["error"] or "")

        with client.stream("GET", f"/api/runs/{run_id}/events") as resp:
            body = "".join(resp.iter_text())

        assert "event: run.finished" in body
        assert "分支未激活" in body
