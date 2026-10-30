"""图校验器单测：拓扑分层、环检测、必填节点类型、变量源校验。

说明：标注 `xfail(strict=True)` 的用例编码的是**目标行为**，当前实现不满足，
对应评审报告里的已知缺陷；修复后该用例会变成 XPASS 而报错，提醒删除标记。
"""

from __future__ import annotations

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


def test_ok_reflects_issues_and_blocking_flags() -> None:
    """S1 回归：ok 不再只等于"无环"，缺输入/输出节点会被标为阻断。"""
    result = validate_graph([_node("n1")], [])

    assert result["ok"] is False
    assert result["blocking"] is True
    assert all(i["blocking"] for i in result["issues"] if i["code"] == "MISSING_OUTPUT")


def _clean_flow(**extra_cfg) -> tuple[list[dict], list[dict]]:
    """input → http → output 的最小可运行图。"""
    nodes = [
        _node("i", "input", key="text"),
        _node("h", "http", url="https://example.com"),
        _node("o", "output", field="result", source="{{ h.body }}"),
    ]
    edges = [_edge("i", "h"), _edge("h", "o")]
    return nodes, edges


def test_warning_only_graph_is_not_blocking() -> None:
    """孤立节点只是提示，不应阻断运行。"""
    nodes, edges = _clean_flow()
    nodes.append(_node("lonely", "python", script="x"))

    result = validate_graph(nodes, edges)

    assert result["ok"] is False
    assert result["blocking"] is False
    assert [i["code"] for i in result["issues"]] == ["ISOLATED"]
    assert result["issues"][0]["blocking"] is False


def test_clean_flow_has_no_issues() -> None:
    nodes, edges = _clean_flow()

    result = validate_graph(nodes, edges)

    assert result["ok"] is True
    assert result["blocking"] is False
    assert result["issues"] == []


def test_unknown_variable_blocks() -> None:
    nodes, edges = _clean_flow()
    nodes[2]["config"]["source"] = "{{ ghost.body }}"

    result = validate_graph(nodes, edges)

    assert result["blocking"] is True
    assert any(i["code"] == "UNKNOWN_VARIABLE" for i in result["issues"])


def test_known_node_field_passes() -> None:
    """http 的已知字段（body）不应报错。"""
    nodes, edges = _clean_flow()

    codes = [i["code"] for i in validate_graph(nodes, edges)["issues"]]

    assert "UNKNOWN_FIELD" not in codes


def test_unknown_field_on_typed_node_blocks() -> None:
    """http 节点没有 statuss 字段 → UNKNOWN_FIELD 且阻断。"""
    nodes, edges = _clean_flow()
    nodes[2]["config"]["source"] = "{{ h.statuss }}"

    result = validate_graph(nodes, edges)

    assert result["blocking"] is True
    issue = next(i for i in result["issues"] if i["code"] == "UNKNOWN_FIELD")
    assert "status" in issue["message"], "错误信息应列出可用字段"


def test_untyped_node_fields_are_not_checked() -> None:
    """llm 的输出形状不可知，不应对字段报错（宁可少报也不误报）。"""
    nodes = [
        _node("l", "llm", prompt="x"),
        _node("o", "output", field="result", source="{{ l.whatever }}"),
    ]
    edges = [_edge("l", "o")]

    codes = [i["code"] for i in validate_graph(nodes, edges)["issues"]]

    assert "UNKNOWN_FIELD" not in codes


def test_extract_declared_fields_are_enforced() -> None:
    nodes = [
        _node("e", "extract", fields_text="title: 标题\nsummary"),
        _node("o", "output", field="result", source="{{ e.title }}"),
    ]
    edges = [_edge("e", "o")]

    assert not [i for i in validate_graph(nodes, edges)["issues"] if i["code"] == "UNKNOWN_FIELD"]

    nodes[1]["config"]["source"] = "{{ e.missing }}"
    issues = validate_graph(nodes, edges)["issues"]
    assert any(i["code"] == "UNKNOWN_FIELD" for i in issues)


def test_input_node_only_exposes_its_key() -> None:
    nodes = [
        _node("i", "input", key="text"),
        _node("o", "output", field="result", source="{{ i.other }}"),
    ]
    edges = [_edge("i", "o")]

    issues = validate_graph(nodes, edges)["issues"]

    assert any(i["code"] == "UNKNOWN_FIELD" for i in issues)
