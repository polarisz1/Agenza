"""GATE-04 Phase 3：跨运行诊断趋势（同类失败 Top N / 成功率 / 空输出率）。"""

from __future__ import annotations

import json
from datetime import timedelta
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.time import utcnow
from app.db.database import SessionLocal
from app.main import app
from app.modules.runs.models import NodeRun, Run


def _insert_run(
    session,
    workflow_id: str,
    *,
    started_at,
    status: str,
    nodes: list[dict],
    error: str | None = None,
) -> str:
    run_id = f"run_trend_{uuid4().hex[:8]}"
    graph = {"version": 1, "inputs": [], "nodes": [], "edges": []}
    session.add(
        Run(
            id=run_id,
            workflow_id=workflow_id,
            workflow_name="趋势用例",
            graph_snapshot=json.dumps(graph, ensure_ascii=False),
            status=status,
            trigger="manual",
            error=error,
            started_at=started_at,
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
                status=node.get("status", "success"),
                error=node.get("error"),
                output_json=node.get("output_json"),
                started_at=started_at,
            )
        )
    session.commit()
    return run_id


def _cleanup(session, workflow_id: str) -> None:
    run_ids = [row[0] for row in session.query(Run.id).filter(Run.workflow_id == workflow_id)]
    if run_ids:
        session.query(NodeRun).filter(NodeRun.run_id.in_(run_ids)).delete(synchronize_session=False)
        session.query(Run).filter(Run.id.in_(run_ids)).delete(synchronize_session=False)
    session.commit()


def test_diagnosis_trends_aggregate_top_failures_and_quality() -> None:
    workflow_id = f"wf_trend_{uuid4().hex[:8]}"
    now = utcnow()
    day2 = now - timedelta(days=2)
    day1 = now - timedelta(days=1)

    with SessionLocal() as session:
        _insert_run(
            session,
            workflow_id,
            started_at=day2,
            status="failed",
            nodes=[
                {
                    "node_type": "llm",
                    "node_name": "鉴权节点",
                    "status": "failed",
                    "error": "鉴权失败（HTTP 401）：请检查服务商密钥",
                },
                {
                    "node_type": "python",
                    "node_name": "脚本节点",
                    "status": "failed",
                    "error": "Empty script",
                },
            ],
        )
        _insert_run(
            session,
            workflow_id,
            started_at=day2 + timedelta(hours=1),
            status="failed",
            nodes=[
                {
                    "node_type": "llm",
                    "node_name": "鉴权节点2",
                    "status": "failed",
                    "error": "鉴权失败（HTTP 401）：请检查服务商密钥",
                }
            ],
        )
        _insert_run(
            session,
            workflow_id,
            started_at=day1,
            status="success",
            nodes=[
                {"node_type": "llm", "output_json": "ok"},
                {"node_type": "python", "output_json": ""},
            ],
        )
        _insert_run(
            session,
            workflow_id,
            started_at=now,
            status="success",
            nodes=[{"node_type": "llm", "output_json": "null"}],
        )

        try:
            with TestClient(app) as client:
                response = client.get(
                    f"/api/runs/diagnosis/trends?workflow_id={workflow_id}&days=3"
                )
            assert response.status_code == 200, response.text
            data = response.json()["data"]

            assert data["workflow_id"] == workflow_id
            assert data["days"] == 3
            assert data["total_runs"] == 4
            assert data["failed_runs"] == 2
            assert data["success_rate"] == 0.5
            # 3 个成功产出节点里 2 个为空（"" 与 "null"）
            assert data["empty_output_rate"] == 0.6667

            assert len(data["points"]) == 3
            assert [point["date"] for point in data["points"]] == sorted(
                point["date"] for point in data["points"]
            )
            today = data["points"][-1]
            assert today["date"] == utcnow().date().isoformat()
            assert today["runs"] == 1
            assert today["success_rate"] == 1.0
            assert today["empty_output_rate"] == 1.0

            top = {item["category"]: item for item in data["top_failures"]}
            assert top["auth"]["count"] == 2
            assert top["auth"]["failed_runs"] == 2
            assert top["script"]["count"] == 1
            assert top["script"]["failed_runs"] == 1
            assert top["auth"]["sample_run_id"]
            # 次数多的排前面
            assert data["top_failures"][0]["category"] == "auth"
        finally:
            _cleanup(session, workflow_id)


def test_diagnosis_trends_scoped_to_workflow_and_top_limit() -> None:
    workflow_id = f"wf_trend_{uuid4().hex[:8]}"
    other_id = f"wf_trend_{uuid4().hex[:8]}"
    now = utcnow()

    with SessionLocal() as session:
        for category, error in (
            ("auth", "鉴权失败（HTTP 401）"),
            ("script", "Empty script"),
            ("timeout", "模型服务超时"),
        ):
            _insert_run(
                session,
                workflow_id,
                started_at=now,
                status="failed",
                nodes=[
                    {
                        "node_type": "llm",
                        "node_name": f"{category} 节点",
                        "status": "failed",
                        "error": error,
                    }
                ],
            )
        _insert_run(
            session,
            other_id,
            started_at=now,
            status="failed",
            nodes=[{"node_type": "llm", "status": "failed", "error": "Empty script"}],
        )

        try:
            with TestClient(app) as client:
                response = client.get(
                    f"/api/runs/diagnosis/trends?workflow_id={workflow_id}&days=1&top=2"
                )
            data = response.json()["data"]
            assert data["total_runs"] == 3
            assert len(data["top_failures"]) == 2
            assert other_id not in {item["sample_run_id"] for item in data["top_failures"]}
        finally:
            _cleanup(session, workflow_id)
            _cleanup(session, other_id)
