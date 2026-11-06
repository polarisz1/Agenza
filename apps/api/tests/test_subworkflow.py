"""TRIGGER-02 Phase A：子工作流（内联执行 / 发布门禁 / 输入映射 / 递归 / 租户隔离）。"""

from __future__ import annotations

import time
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.engine.contexts import NodeContext
from app.core.engine.executors.subworkflow import SubWorkflowExecutor
from app.db.database import SessionLocal
from app.main import app
from app.modules.runs.models import NodeRun, Run
from app.modules.workflows.models import Workflow, WorkflowVersion


def _child_graph(required: bool = True) -> dict:
    return {
        "version": 1,
        "inputs": [{"key": "text", "label": "文本", "type": "text", "required": required}],
        "nodes": [
            {
                "id": "c_in",
                "type": "input",
                "name": "输入",
                "position": {"x": 0, "y": 0},
                "config": {"key": "text"},
            },
            {
                "id": "c_out",
                "type": "output",
                "name": "输出",
                "position": {"x": 200, "y": 0},
                "config": {"field": "result", "source": "{{ 输入.text }}"},
            },
        ],
        "edges": [{"id": "ce1", "source": "c_in", "target": "c_out"}],
    }


def _failing_child_graph() -> dict:
    return {
        "version": 1,
        "inputs": [{"key": "text", "label": "文本", "type": "text", "required": True}],
        "nodes": [
            {
                "id": "c_in",
                "type": "input",
                "name": "输入",
                "position": {"x": 0, "y": 0},
                "config": {"key": "text"},
            },
            {
                "id": "c_bad",
                "type": "python",
                "name": "失败脚本",
                "position": {"x": 200, "y": 0},
                "config": {"script": "raise RuntimeError('child boom')"},
            },
            {
                "id": "c_out",
                "type": "output",
                "name": "输出",
                "position": {"x": 400, "y": 0},
                "config": {"field": "result", "source": "{{ 失败脚本 }}"},
            },
        ],
        "edges": [
            {"id": "ce1", "source": "c_in", "target": "c_bad"},
            {"id": "ce2", "source": "c_bad", "target": "c_out"},
        ],
    }


def _parent_graph(child_id: str, mapping: dict | None = None) -> dict:
    return {
        "version": 1,
        "inputs": [{"key": "text", "label": "文本", "type": "text", "required": True}],
        "nodes": [
            {
                "id": "p_in",
                "type": "input",
                "name": "输入",
                "position": {"x": 0, "y": 0},
                "config": {"key": "text"},
            },
            {
                "id": "p_sub",
                "type": "subworkflow",
                "name": "子流程",
                "position": {"x": 200, "y": 0},
                "config": {
                    "workflow_id": child_id,
                    "input_mapping": {"text": "{{ 输入.text }}"} if mapping is None else mapping,
                },
            },
            {
                "id": "p_out",
                "type": "output",
                "name": "输出",
                "position": {"x": 400, "y": 0},
                "config": {"field": "result", "source": "{{ 子流程.result }}"},
            },
        ],
        "edges": [
            {"id": "pe1", "source": "p_in", "target": "p_sub"},
            {"id": "pe2", "source": "p_sub", "target": "p_out"},
        ],
    }


def _create(client: TestClient, name: str, graph: dict, headers: dict | None = None) -> str:
    response = client.post(
        "/api/workflows" if headers is None else "/api/v1/workflows",
        json={"name": name, "graph": graph},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]["id"]


def _publish(client: TestClient, workflow_id: str, headers: dict | None = None) -> None:
    response = client.post(
        f"/api/workflows/{workflow_id}/publish"
        if headers is None
        else f"/api/v1/workflows/{workflow_id}/publish",
        headers=headers,
    )
    assert response.status_code == 200, response.text


def _run(client: TestClient, workflow_id: str, inputs: dict, headers: dict | None = None) -> dict:
    response = client.post(
        f"/api/workflows/{workflow_id}/runs"
        if headers is None
        else f"/api/v1/workflows/{workflow_id}/runs",
        json={"inputs": inputs},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _wait(
    client: TestClient, run_id: str, headers: dict | None = None, timeout: float = 8.0
) -> dict:
    deadline = time.time() + timeout
    detail: dict = {}
    while time.time() < deadline:
        response = client.get(
            f"/api/runs/{run_id}" if headers is None else f"/api/v1/runs/{run_id}",
            headers=headers,
        )
        assert response.status_code == 200, response.text
        detail = response.json()["data"]
        if detail["status"] != "running":
            return detail
        time.sleep(0.05)
    raise AssertionError(f"run {run_id} did not finish: {detail.get('status')}")


def _nodes(detail: dict) -> dict[str, dict]:
    return {node["node_id"]: node for node in detail["nodes"]}


def _cleanup(workflow_ids: list[str]) -> None:
    if not workflow_ids:
        return
    with SessionLocal() as session:
        run_ids = [
            row[0] for row in session.query(Run.id).filter(Run.workflow_id.in_(workflow_ids))
        ]
        if run_ids:
            session.query(NodeRun).filter(NodeRun.run_id.in_(run_ids)).delete(
                synchronize_session=False
            )
        session.query(Run).filter(Run.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(WorkflowVersion).filter(WorkflowVersion.workflow_id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.query(Workflow).filter(Workflow.id.in_(workflow_ids)).delete(
            synchronize_session=False
        )
        session.commit()


def _register(client: TestClient, label: str) -> tuple[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": f"{label}-{uuid4().hex[:8]}@example.com",
            "password": "Password123!",
            "name": label,
            "workspace_name": f"{label} Workspace",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    return data["access_token"], data["workspace_id"]


def test_subworkflow_runs_published_child_with_input_mapping() -> None:
    with TestClient(app) as client:
        child = _create(client, "子流程", _child_graph())
        _publish(client, child)
        parent = _create(client, "父流程", _parent_graph(child))

        started = _run(client, parent, {"text": "hello"})
        detail = _wait(client, started["id"])
        nodes = _nodes(detail)

        assert detail["status"] == "success", detail
        assert nodes["p_sub"]["status"] == "success"
        assert nodes["p_sub"]["output"] == {"result": "hello"}
        assert nodes["p_out"]["output"] == {"result": "hello"}

        # Phase B：子节点以 `父节点/子节点` 路径落库，并带层级名称
        assert nodes["p_sub/c_in"]["status"] == "success"
        assert nodes["p_sub/c_out"]["output"] == {"result": "hello"}
        assert "子流程 /" in nodes["p_sub/c_in"]["node_name"]

        # Phase B：子节点事件进入父 Run 的 SSE 通道
        with client.stream("GET", f"/api/runs/{started['id']}/events") as resp:
            body = "".join(resp.iter_text())
        assert "p_sub/c_in" in body
        assert "p_sub/c_out" in body

    _cleanup([child, parent])


def test_subworkflow_rejects_unpublished_child() -> None:
    with TestClient(app) as client:
        child = _create(client, "未发布子流程", _child_graph())
        parent = _create(client, "父流程-未发布", _parent_graph(child))

        started = _run(client, parent, {"text": "hello"})
        detail = _wait(client, started["id"])
        nodes = _nodes(detail)

        assert detail["status"] == "failed", detail
        assert "尚未发布" in (nodes["p_sub"]["error"] or "")
        assert "子工作流" in (detail["error"] or "")

    _cleanup([child, parent])


def test_subworkflow_rejects_missing_required_input() -> None:
    with TestClient(app) as client:
        child = _create(client, "必填子流程", _child_graph(required=True))
        _publish(client, child)
        parent = _create(client, "父流程-缺输入", _parent_graph(child, mapping={}))

        started = _run(client, parent, {"text": "hello"})
        detail = _wait(client, started["id"])
        nodes = _nodes(detail)

        assert detail["status"] == "failed", detail
        assert "缺少必填输入" in (nodes["p_sub"]["error"] or "")
        assert "text" in (nodes["p_sub"]["error"] or "")

    _cleanup([child, parent])


def test_subworkflow_detects_self_reference() -> None:
    with TestClient(app) as client:
        workflow_id = _create(client, "自引用工作流", _child_graph())
        updated = client.put(
            f"/api/workflows/{workflow_id}",
            json={"graph": _parent_graph(workflow_id)},
        )
        assert updated.status_code == 200, updated.text
        _publish(client, workflow_id)

        started = _run(client, workflow_id, {"text": "hello"})
        detail = _wait(client, started["id"])
        nodes = _nodes(detail)

        assert detail["status"] == "failed", detail
        assert "循环引用" in (nodes["p_sub"]["error"] or "")

    _cleanup([workflow_id])


def test_subworkflow_failure_is_attributed_to_child_node() -> None:
    with TestClient(app) as client:
        child = _create(client, "失败子流程", _failing_child_graph())
        _publish(client, child)
        parent = _create(client, "父流程-子节点失败", _parent_graph(child))

        started = _run(client, parent, {"text": "hello"})
        detail = _wait(client, started["id"])
        nodes = _nodes(detail)

        assert detail["status"] == "failed", detail
        assert nodes["p_sub"]["status"] == "failed"
        assert nodes["p_sub/c_bad"]["status"] == "failed"

        diagnosis = client.get(f"/api/runs/{started['id']}/diagnosis")
        assert diagnosis.status_code == 200, diagnosis.text
        ids = [item["node_id"] for item in diagnosis.json()["data"]["items"]]
        assert "p_sub/c_bad" in ids
        # 父级 subworkflow 的重复诊断被抑制，只保留更具体的子节点
        assert "p_sub" not in ids

    _cleanup([child, parent])


async def test_subworkflow_depth_limit_guard() -> None:
    executor = SubWorkflowExecutor()
    ctx = NodeContext(
        node={
            "id": "n1",
            "type": "subworkflow",
            "name": "子流程",
            "config": {"workflow_id": "w6"},
        },
        run_inputs={},
        workflow_stack=["w1", "w2", "w3", "w4", "w5"],
        subworkflow_loader=lambda _wid: None,
    )

    result = await executor.execute(ctx)

    assert result.status == "failed"
    assert "最大深度" in (result.error or "")


def test_subworkflow_is_workspace_scoped(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    workflow_ids: list[str] = []
    with TestClient(app) as client:
        token_a, _ws_a = _register(client, "sub-a")
        headers_a = {"Authorization": f"Bearer {token_a}"}
        child = _create(client, "A 的子流程", _child_graph(), headers_a)
        workflow_ids.append(child)
        _publish(client, child, headers_a)

        token_b, _ws_b = _register(client, "sub-b")
        headers_b = {"Authorization": f"Bearer {token_b}"}
        parent = _create(client, "B 的父流程", _parent_graph(child), headers_b)
        workflow_ids.append(parent)

        started = _run(client, parent, {"text": "hello"}, headers_b)
        detail = _wait(client, started["id"], headers_b)
        nodes = _nodes(detail)

        assert detail["status"] == "failed", detail
        assert "不存在或不属于当前工作空间" in (nodes["p_sub"]["error"] or "")

    _cleanup(workflow_ids)
