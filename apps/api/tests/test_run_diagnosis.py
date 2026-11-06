"""GATE-04：确定性根因分析（失败节点 + 运行级兜底）。"""

from __future__ import annotations

import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.time import utcnow
from app.db.database import SessionLocal
from app.main import app
from app.modules.runs.models import NodeRun, Run


def _insert_run(
    session,
    *,
    nodes: list[dict],
    graph_nodes: list[dict] | None = None,
    run_error: str | None = None,
    status: str = "failed",
) -> str:
    run_id = f"run_diag_{uuid4().hex[:8]}"
    graph = {
        "version": 1,
        "inputs": [],
        "nodes": graph_nodes or [],
        "edges": [],
    }
    session.add(
        Run(
            id=run_id,
            workflow_id="wf_diag",
            workflow_name="诊断用例",
            graph_snapshot=json.dumps(graph, ensure_ascii=False),
            status=status,
            trigger="manual",
            error=run_error,
            started_at=utcnow(),
        )
    )
    for index, node in enumerate(nodes):
        session.add(
            NodeRun(
                id=f"nr_{uuid4().hex[:8]}",
                run_id=run_id,
                node_id=node.get("node_id", f"n{index}"),
                node_type=node.get("node_type", "llm"),
                node_name=node.get("node_name", f"节点{index}"),
                status=node.get("status", "failed"),
                error=node.get("error"),
                output_json=node.get("output_json"),
                model=node.get("model"),
                tokens_in=node.get("tokens_in", 0),
                tokens_out=node.get("tokens_out", 0),
                duration_ms=node.get("duration_ms", 1200),
                started_at=utcnow(),
            )
        )
    session.commit()
    return run_id


def _cleanup(session, run_id: str) -> None:
    session.query(NodeRun).filter(NodeRun.run_id == run_id).delete(synchronize_session=False)
    session.query(Run).filter(Run.id == run_id).delete(synchronize_session=False)
    session.commit()


def test_diagnosis_covers_common_errors() -> None:
    with SessionLocal() as session:
        run_id = _insert_run(
            session,
            graph_nodes=[
                {
                    "id": "extract_1",
                    "type": "extract",
                    "config": {"fields_text": "competitor: 竞品\nstrengths: 优势"},
                },
                {"id": "timeout_1", "type": "llm", "config": {"timeout": 120}},
            ],
            nodes=[
                {
                    "node_id": "auth_1",
                    "node_type": "llm",
                    "error": "鉴权失败（HTTP 401）：请检查服务商密钥",
                },
                {
                    "node_id": "extract_1",
                    "node_type": "extract",
                    "error": "抽取结果缺少字段：competitor, strengths",
                    "output_json": '{"competitor": "A"}',
                },
                {
                    "node_id": "json_1",
                    "node_type": "extract",
                    "error": "JSON parse failed: Expecting value",
                    "output_json": '```json\n{"a": 1}\n```',
                },
                {
                    "node_id": "timeout_1",
                    "node_type": "llm",
                    "error": "模型服务超时",
                    "duration_ms": 120000,
                },
                {
                    "node_id": "script_1",
                    "node_type": "python",
                    "error": "Script exit 1: Traceback (most recent call last)",
                },
                {
                    "node_id": "budget_1",
                    "node_type": "llm",
                    "error": "月度 AI 预算已用完（已用 $6.00 / 上限 $6.00），已按硬停机策略停止模型调用",
                },
            ],
        )

        try:
            with TestClient(app) as client:
                response = client.get(f"/api/runs/{run_id}/diagnosis")
            assert response.status_code == 200, response.text
            data = response.json()["data"]
            assert data["run_id"] == run_id
            by_node = {item["node_id"]: item for item in data["items"]}

            assert by_node["auth_1"]["category"] == "auth"
            assert by_node["auth_1"]["suggestions"][0]["action"] == "open_models"

            missing = by_node["extract_1"]
            assert missing["category"] == "missing_fields"
            assert "competitor" in missing["root_cause"]
            assert any(e["label"] == "期望字段" for e in missing["evidence"])
            assert any(s["action"] == "edit_prompt" for s in missing["suggestions"])

            json_item = by_node["json_1"]
            assert json_item["category"] == "json_format"
            assert "Markdown" in json_item["root_cause"]
            assert any(e["label"] == "节点输出" for e in json_item["evidence"])

            timeout = by_node["timeout_1"]
            assert timeout["category"] == "timeout"
            assert any(e["label"] == "节点超时设置" for e in timeout["evidence"])

            assert by_node["script_1"]["category"] == "script"
            assert by_node["budget_1"]["category"] == "budget"
            assert by_node["budget_1"]["suggestions"][0]["action"] == "open_gateway"

            # 每条结果都带证据与建议，且严重度统一为阻断
            assert all(item["severity"] == "blocking" for item in data["items"])
            assert all(item["evidence"] for item in data["items"])
            assert all(item["suggestions"] for item in data["items"])
        finally:
            _cleanup(session, run_id)


def test_diagnosis_run_level_fallback() -> None:
    """启动即失败（没有节点记录）时给出运行级诊断，避免诊断页空白。"""
    with SessionLocal() as session:
        run_id = _insert_run(session, nodes=[], run_error="无法连接到模型服务地址")
        try:
            with TestClient(app) as client:
                response = client.get(f"/api/runs/{run_id}/diagnosis")
            items = response.json()["data"]["items"]
            assert len(items) == 1
            assert items[0]["node_id"] == ""
            assert items[0]["node_type"] == "run"
            assert items[0]["category"] == "network"
        finally:
            _cleanup(session, run_id)


def test_diagnosis_unknown_and_missing_run() -> None:
    with SessionLocal() as session:
        run_id = _insert_run(
            session,
            nodes=[{"node_id": "weird", "error": "某种还没见过的错误"}],
        )
        try:
            with TestClient(app) as client:
                response = client.get(f"/api/runs/{run_id}/diagnosis")
                assert response.status_code == 200, response.text
                item = response.json()["data"]["items"][0]
                assert item["category"] == "unknown"
                assert item["confidence"] < 0.5
                assert item["suggestions"]

                missing = client.get("/api/runs/run_missing/diagnosis")
                assert missing.status_code == 404
        finally:
            _cleanup(session, run_id)


def test_success_run_has_no_diagnosis_items() -> None:
    with SessionLocal() as session:
        run_id = _insert_run(
            session,
            nodes=[{"node_id": "ok", "status": "success", "error": None}],
            status="success",
        )
        try:
            with TestClient(app) as client:
                response = client.get(f"/api/runs/{run_id}/diagnosis")
            assert response.json()["data"]["items"] == []
        finally:
            _cleanup(session, run_id)
