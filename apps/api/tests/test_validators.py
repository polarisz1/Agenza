"""图校验器单测：拓扑分层、环检测、必填节点类型、变量源校验。

说明：标注 `xfail(strict=True)` 的用例编码的是**目标行为**，当前实现不满足，
对应评审报告里的已知缺陷；修复后该用例会变成 XPASS 而报错，提醒删除标记。
"""

from __future__ import annotations

import pytest

from app.core.engine.validators import detect_cycle, kahn_layers, validate_graph


def _node(node_id: str, node_type: str = "llm", **config) -> dict:
    return {"id": node_id, "type": node_type, "name": node_id, "config": config}


def _edge(source: str, target: str) -> dict:
    return {"id": f"e_{source}_{target}", "source": source, "target": target}


def test_kahn_layers_diamond() -> None:
    nodes = [_node("a"), _node("b"), _node("c"), _node("d")]
    edges = [_edge("a", "b"), _edge("a", "c"), _edge("b", "d"), _edge("c", "d")]

    assert kahn_layers(nodes, edges) == [["a"], ["b", "c"], ["d"]]


def test_kahn_layers_ignores_dangling_edges() -> None:
    nodes = [_node("a")]
    edges = [_edge("a", "ghost"), _edge("ghost", "a")]

    assert kahn_layers(nodes, edges) == [["a"]]


def test_detect_cycle_returns_chain() -> None:
    nodes = [_node("a"), _node("b"), _node("c")]
    edges = [_edge("a", "b"), _edge("b", "c"), _edge("c", "a")]

    cycles = detect_cycle(nodes, edges)

    assert cycles, "应当检测到环"
    assert cycles[0][0] == cycles[0][-1], "环链首尾应相同"


def test_acyclic_graph_has_no_cycle() -> None:
    nodes = [_node("a"), _node("b")]
    assert detect_cycle(nodes, [_edge("a", "b")]) == []


def test_validate_graph_flags_isolated_and_required_types() -> None:
    result = validate_graph([_node("n1")], [])

    codes = {issue["code"] for issue in result["issues"]}
    assert {"ISOLATED", "MISSING_INPUT", "MISSING_OUTPUT"} <= codes


def test_validate_graph_rejects_cycle() -> None:
    nodes = [_node("a", "input"), _node("b"), _node("out", "output")]
    edges = [_edge("a", "b"), _edge("b", "out"), _edge("out", "b")]

    assert validate_graph(nodes, edges)["ok"] is False


def test_unknown_variable_source_is_flagged() -> None:
    nodes = [
        _node("a", "input", key="text"),
        _node("b", "llm", prompt="{{ ghost.field }}"),
        _node("out", "output"),
    ]
    edges = [_edge("a", "b"), _edge("b", "out")]

    issues = validate_graph(nodes, edges)["issues"]

    assert any(i["code"] == "UNKNOWN_VARIABLE" for i in issues)


def test_condition_edge_without_port_is_flagged() -> None:
    """条件节点出边没标分支 → 提示（旧图画法，两种分支都会执行）。"""
    nodes = [_node("c", "condition", left="a", op="eq", right="a"), _node("t", "output")]
    edges = [_edge("c", "t")]

    codes = [i["code"] for i in validate_graph(nodes, edges)["issues"]]

    assert "CONDITION_EDGE_NO_PORT" in codes


def test_condition_unused_branch_is_flagged() -> None:
    """只连了真分支 → 提示假分支未使用。"""
    nodes = [_node("c", "condition"), _node("t", "output")]
    edges = [{**_edge("c", "t"), "from_port": "true"}]

    issues = validate_graph(nodes, edges)["issues"]

    assert any(i["code"] == "CONDITION_BRANCH_UNUSED" and "假" in i["message"] for i in issues), (
        issues
    )


def test_condition_both_branches_wired_is_clean() -> None:
    nodes = [_node("c", "condition"), _node("t1", "output"), _node("t2", "output")]
    edges = [
        {**_edge("c", "t1"), "from_port": "true"},
        {**_edge("c", "t2"), "from_port": "false"},
    ]

    codes = [i["code"] for i in validate_graph(nodes, edges)["issues"]]

    assert "CONDITION_EDGE_NO_PORT" not in codes
    assert "CONDITION_BRANCH_UNUSED" not in codes


@pytest.mark.xfail(
    strict=True,
    reason="S1：validate_graph 的 ok 只反映“无环”，MISSING_INPUT/OUTPUT 等不阻断运行",
)
def test_ok_should_reflect_all_blocking_issues() -> None:
    result = validate_graph([_node("n1")], [])

    assert result["ok"] is False
