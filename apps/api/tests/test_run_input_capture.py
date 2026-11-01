"""F1/B3：节点输入必须落库并随运行详情返回。

"过程可见"此前只兑现了输出侧：`node_run.input_json` 字段存在，但从未写入、
接口也不返回。这里用真实引擎跑一张 input → python → output 的图做端到端断言。
"""

from __future__ import annotations

import time

import pytest
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
            "id": "py",
            "type": "python",
            "name": "脚本1",
            "position": {"x": 200, "y": 0},
            "config": {"script": "agentflow_result = {'ok': True}\n"},
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


def _wait(client: TestClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    detail: dict = {}
    while time.time() < deadline:
        detail = client.get(f"/api/runs/{run_id}").json()["data"]
        if detail["status"] != "running":
            return detail
        time.sleep(0.05)
    pytest.fail(f"run {run_id} did not finish: {detail.get('status')}")


def test_node_input_is_captured_and_returned() -> None:
    with TestClient(app) as client:
        wf = client.post("/api/workflows", json={"name": "输入捕获", "graph": GRAPH})
        assert wf.status_code == 200, wf.text
        run = client.post(
            f"/api/workflows/{wf.json()['data']['id']}/runs",
            json={"inputs": {"text": "hello"}},
        )
        assert run.status_code == 200, run.text
        detail = _wait(client, run.json()["data"]["id"])

    assert detail["status"] == "success"
    nodes = {node["node_id"]: node for node in detail["nodes"]}

    # 每个实际执行的节点都能看到"工作流输入 + 直接上游输出"
    script = nodes["py"]
    assert script["input"]["inputs"]["text"] == "hello"
    assert script["input"]["upstream"]["in"] == {"text": "hello"}

    output = nodes["out"]
    assert output["input"]["upstream"]["py"] == {"ok": True}

    # 输入节点没有上游，但也要能看到工作流输入
    source = nodes["in"]
    assert source["input"] == {"inputs": {"text": "hello"}, "upstream": {}}
