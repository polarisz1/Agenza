"""图契约（判别联合）单测：8 类节点、分支端口、未知类型与未知字段的行为。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.modules.workflows.schemas import EdgeDef, GraphDef, WorkflowResponse


def _node(node_id: str, node_type: str, config: dict | None = None) -> dict:
    return {
        "id": node_id,
        "type": node_type,
        "name": node_id,
        "position": {"x": 1, "y": 2},
        "config": config or {},
    }


ALL_TYPES = ["input", "llm", "extract", "http", "python", "condition", "merge", "output"]


def test_graph_accepts_all_eight_node_types() -> None:
    graph = GraphDef(
        nodes=[_node(f"n_{t}", t) for t in ALL_TYPES],
        edges=[EdgeDef(id="e1", source="n_input", target="n_llm")],
    )

    assert [n.type for n in graph.nodes] == ALL_TYPES
    # 每类节点都应解析出对应 config 模型
    assert graph.nodes[1].config.model_dump()["temperature"] == 0.7


def test_condition_edge_carries_branch_port() -> None:
    edge = EdgeDef(id="e", source="c", target="t", from_port="true")
    assert edge.from_port == "true"

    with pytest.raises(ValidationError):
        EdgeDef(id="e", source="c", target="t", from_port="yes")


def test_unknown_node_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        GraphDef(nodes=[_node("x", "not-a-node")])


def test_unknown_config_keys_are_ignored() -> None:
    """历史图里有已废弃字段时，读取不应 500。"""
    graph = GraphDef(nodes=[_node("p", "python", {"script": "print(1)", "legacy_flag": True})])

    assert graph.nodes[0].config.script == "print(1)"
    assert not hasattr(graph.nodes[0].config, "legacy_flag")


def test_config_defaults_do_not_change_behaviour() -> None:
    """缺省 config 也应给出可用默认值（enabled=True 才不会被当成跳过）。"""
    graph = GraphDef(nodes=[_node("p", "python")])
    config = graph.nodes[0].config

    assert config.enabled is True
    assert config.retry == 0
    assert config.timeout_s is None


def test_condition_op_is_constrained() -> None:
    graph = GraphDef(nodes=[_node("c", "condition", {"op": "gt"})])
    assert graph.nodes[0].config.op == "gt"

    with pytest.raises(ValidationError):
        GraphDef(nodes=[_node("c", "condition", {"op": "bogus"})])


def test_node_def_union_discriminates_by_type() -> None:
    """Annotated 联合：构造时按 type 落到具体模型，而不是落到第一个变体。"""
    graph = GraphDef(nodes=[_node("m", "merge", {"strategy": "any"})])

    assert graph.nodes[0].__class__.__name__ == "MergeNode"


def test_workflow_response_coerces_stored_dict_graph() -> None:
    """数据库里存的是 dict，响应模型应当校验成 GraphDef。"""
    from datetime import datetime

    response = WorkflowResponse(
        id="wf_1",
        name="x",
        status="draft",
        graph={"version": 1, "inputs": [], "nodes": [_node("i", "input")], "edges": []},
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )

    assert isinstance(response.graph, GraphDef)
    assert response.graph.nodes[0].type == "input"
