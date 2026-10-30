"""SSE 回放语义单测（S5/S6）：

- 后端重启（内存无历史）时用 DB 回放，且事件带单调递增的 seq，客户端重连能对齐
- 本进程已有历史时不再走 DB 回放（避免重复/乱序）
- 事件端点对未知 run 返回 404，且不再依赖请求级 Session
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.core.engine.event_bus import get_event_bus
from app.main import app
from app.modules.runs.router import _replay_from_db

GRAPH = {
    "version": 1,
    "inputs": [],
    "nodes": [
        {"id": "i", "type": "input", "name": "输入", "config": {"key": "t"}},
        {"id": "o", "type": "output", "name": "输出", "config": {"field": "result"}},
    ],
    "edges": [{"id": "e1", "source": "i", "target": "o"}],
}


def _finished_run(client: TestClient) -> str:
    wf = client.post("/api/workflows", json={"name": "SSE 用例", "graph": GRAPH})
    wf_id = wf.json()["data"]["id"]
    run_id = client.post(f"/api/workflows/{wf_id}/runs", json={"inputs": {"t": "x"}}).json()[
        "data"
    ]["id"]

    for _ in range(100):
        detail = client.get(f"/api/runs/{run_id}").json()["data"]
        if detail["status"] != "running":
            return run_id
        time.sleep(0.05)
    raise AssertionError("run did not finish")


def _seq_of(chunk: str) -> int | None:
    for line in chunk.splitlines():
        if line.startswith("id: "):
            return int(line[4:])
    return None


async def test_db_replay_assigns_monotonic_seq() -> None:
    with TestClient(app) as client:
        run_id = _finished_run(client)

    chunks = []
    async for text, terminal in _replay_from_db(run_id, base_seq=10):
        chunks.append((text, terminal))

    assert chunks, "应当回放出事件"
    seqs = [_seq_of(text) for text, _ in chunks]
    assert seqs[0] == 11, f"应从 base_seq+1 开始：{seqs}"
    assert all(s is not None for s in seqs)
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs), "seq 必须单调且不重复"
    assert chunks[-1][1] is True, "最后一条应是终止事件"
    assert "run.finished" in chunks[-1][0]


def test_sse_endpoint_replays_when_no_memory_history() -> None:
    with TestClient(app) as client:
        run_id = _finished_run(client)
        bus = get_event_bus()
        assert bus.has_history(run_id) is True

        # 模拟后端重启：清掉内存历史
        bus._history.pop(run_id, None)
        bus._seq.pop(run_id, None)
        assert bus.has_history(run_id) is False

        with client.stream("GET", f"/api/runs/{run_id}/events") as resp:
            body = "".join(resp.iter_text())

    assert "event: node.finished" in body
    assert "event: run.finished" in body
    assert "id: 1" in body, "回放事件必须带 seq，否则客户端 Last-Event-ID 无法对齐"


def test_sse_unknown_run_returns_404() -> None:
    with TestClient(app) as client:
        resp = client.get("/api/runs/r_does_not_exist/events")
    assert resp.status_code == 404
