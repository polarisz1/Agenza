"""设置项真实生效 + 清空运行级联（S7/S8）。

- clear-runs 必须同时删 node_run，否则留下孤儿数据
- retention_per_workflow 改小后，旧的运行会被清理
- default_timeout 改小后，没配 timeout_s 的节点会按它超时
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db.database import SessionLocal
from app.main import app

SIMPLE_GRAPH = {
    "version": 1,
    "inputs": [],
    "nodes": [
        {"id": "i", "type": "input", "name": "输入", "config": {"key": "t"}},
        {"id": "o", "type": "output", "name": "输出", "config": {"field": "result"}},
    ],
    "edges": [{"id": "e1", "source": "i", "target": "o"}],
}


def _wait(client: TestClient, run_id: str, timeout: float = 10.0) -> dict:
    deadline = time.time() + timeout
    detail: dict = {}
    while time.time() < deadline:
        detail = client.get(f"/api/runs/{run_id}").json()["data"]
        if detail["status"] != "running":
            return detail
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} did not finish")


def _run_once(client: TestClient, wf_id: str) -> dict:
    run_id = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {"t": "x"}}).json()[
        "data"
    ]["id"]
    return _wait(client, run_id)


def test_clear_runs_also_deletes_node_runs() -> None:
    with TestClient(app) as client:
        wf = client.post("/api/workflows", json={"name": "清空用例", "graph": SIMPLE_GRAPH})
        wf_id = wf.json()["data"]["id"]
        detail = _run_once(client, wf_id)
        assert detail["nodes"], "先要有节点级记录"

        cleared = client.post("/api/settings/system/clear-runs").json()["data"]
        assert cleared["cleared"] >= 1

        assert client.get("/api/runs").json()["data"]["items"] == []
        with SessionLocal() as db:
            remaining = db.execute(text("select count(*) from node_run")).scalar()
        assert remaining == 0, "node_run 必须一起清掉"


def test_retention_setting_is_applied() -> None:
    with TestClient(app) as client:
        client.put("/api/settings", json={"retention_per_workflow": 2})
        try:
            wf = client.post("/api/workflows", json={"name": "保留用例", "graph": SIMPLE_GRAPH})
            wf_id = wf.json()["data"]["id"]

            for _ in range(4):
                _run_once(client, wf_id)

            runs = client.get(f"/api/runs?workflow_id={wf_id}").json()["data"]["items"]
            assert len(runs) == 2, f"应只保留 2 条，实际 {len(runs)}"
        finally:
            client.put("/api/settings", json={"retention_per_workflow": 200})


def test_default_timeout_setting_is_applied() -> None:
    """节点没配 timeout_s 时，按设置页的 default_timeout 超时。"""
    slow_script = "import time\ntime.sleep(5)\nagentflow_result = {}\n"
    graph = {
        "version": 1,
        "inputs": [],
        "nodes": [
            {"id": "i", "type": "input", "name": "输入", "config": {"key": "t"}},
            {
                "id": "p",
                "type": "python",
                "name": "慢脚本",
                "config": {"script": slow_script},
            },
            {"id": "o", "type": "output", "name": "输出", "config": {"field": "result"}},
        ],
        "edges": [
            {"id": "e1", "source": "i", "target": "p"},
            {"id": "e2", "source": "p", "target": "o"},
        ],
    }

    with TestClient(app) as client:
        client.put("/api/settings", json={"default_timeout": 1})
        try:
            wf = client.post("/api/workflows", json={"name": "超时用例", "graph": graph})
            wf_id = wf.json()["data"]["id"]
            detail = _run_once(client, wf_id)

            nodes = {n["node_id"]: n for n in detail["nodes"]}
            assert nodes["p"]["status"] == "failed"
            assert "timed out" in (nodes["p"]["error"] or "").lower()
            assert detail["status"] == "failed"
        finally:
            client.put("/api/settings", json={"default_timeout": 120})
