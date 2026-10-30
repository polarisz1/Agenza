"""DAG validator - cycle detection + required fields + variable refs."""

from __future__ import annotations

import re
from typing import Any

_VAR_PATTERN = re.compile(r"\{\{\s*([^\s{}]+?)\s*\}\}")


def _iter_strings(value: Any):
    """递归遍历 config，产出所有字符串值。"""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_strings(item)


def validate_variables(nodes: list[dict]) -> list[dict]:
    """检查 {{ 源.字段 }} 的“源”是否存在（节点名称 / 节点 id / inputs）。"""
    known = {"inputs"}
    for node in nodes:
        known.add(str(node.get("id", "")))
        if node.get("name"):
            known.add(str(node["name"]))

    issues: list[dict] = []
    seen: set[tuple[str, str]] = set()

    for node in nodes:
        node_id = str(node.get("id", ""))
        for text in _iter_strings(node.get("config", {})):
            for match in _VAR_PATTERN.finditer(text):
                source = re.split(r"[.\[]", match.group(1), maxsplit=1)[0]
                if source in known:
                    continue
                key = (node_id, source)
                if key in seen:
                    continue
                seen.add(key)
                issues.append(
                    {
                        "code": "UNKNOWN_VARIABLE",
                        "node_id": node_id,
                        "message": f"引用了不存在的节点/变量源 '{source}'",
                    }
                )
    return issues


def detect_cycle(nodes: list[dict], edges: list[dict]) -> list[list[str]]:
    """Return list of cycle chains, or empty if acyclic."""
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        if e.get("source") in adj and e.get("target") in adj:
            adj[e["source"]].append(e["target"])

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in adj}
    cycles: list[list[str]] = []

    def dfs(node: str, stack: list[str]):
        color[node] = GRAY
        stack.append(node)
        for nxt in adj.get(node, []):
            if color[nxt] == GRAY:
                # cycle found
                start = stack.index(nxt)
                cycles.append([*stack[start:], nxt])
            elif color[nxt] == WHITE:
                dfs(nxt, stack)
        stack.pop()
        color[node] = BLACK

    for n in adj:
        if color[n] == WHITE:
            dfs(n, [])
    return cycles


def kahn_layers(nodes: list[dict], edges: list[dict]) -> list[list[str]]:
    """Topological layers: nodes ready to run at each step."""
    indeg = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    for e in edges:
        s, t = e.get("source"), e.get("target")
        if s in adj and t in indeg:
            indeg[t] += 1
            adj[s].append(t)

    layers: list[list[str]] = []
    ready = [nid for nid, d in indeg.items() if d == 0]
    while ready:
        layers.append(ready)
        new_ready = []
        for nid in ready:
            for nxt in adj[nid]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    new_ready.append(nxt)
        ready = new_ready
    return layers


def validate_branches(nodes: list[dict], edges: list[dict]) -> list[dict]:
    """条件节点的分支连线检查（提示级，不阻断运行）。"""
    condition_ids = {str(n.get("id")) for n in nodes if n.get("type") == "condition"}
    if not condition_ids:
        return []

    issues: list[dict] = []
    used: dict[str, set[str]] = {cid: set() for cid in condition_ids}

    for e in edges:
        source = str(e.get("source"))
        if source not in condition_ids:
            continue
        port = e.get("from_port")
        if port in ("true", "false"):
            used[source].add(port)
        else:
            issues.append(
                {
                    "code": "CONDITION_EDGE_NO_PORT",
                    "node_id": source,
                    "message": "条件节点的出边未指定「真/假」分支，该下游在两种情况下都会执行",
                }
            )

    for cid, ports in used.items():
        for missing, label in (("true", "真"), ("false", "假")):
            if missing not in ports:
                issues.append(
                    {
                        "code": "CONDITION_BRANCH_UNUSED",
                        "node_id": cid,
                        "message": f"条件节点的「{label}」分支没有连线",
                    }
                )
    return issues


def validate_graph(nodes: list[dict], edges: list[dict]) -> dict[str, Any]:
    """Run all structural validations. Returns {ok, issues}."""
    issues: list[dict] = []

    cycles = detect_cycle(nodes, edges)
    for cyc in cycles:
        issues.append(
            {"code": "CYCLE", "node_id": cyc[0], "message": f"Cycle detected: {' → '.join(cyc)}"}
        )

    # Isolated nodes
    connected: set[str] = set()
    for e in edges:
        connected.add(e.get("source", ""))
        connected.add(e.get("target", ""))
    for n in nodes:
        if n["id"] not in connected and n.get("type") not in ("input", "output"):
            issues.append(
                {
                    "code": "ISOLATED",
                    "node_id": n["id"],
                    "message": "Node is not connected to the main flow",
                }
            )

    # Required node types
    node_types = {n["id"]: n.get("type") for n in nodes}
    if "input" not in node_types.values():
        issues.append(
            {"code": "MISSING_INPUT", "node_id": "", "message": "At least one Input node required"}
        )
    if "output" not in node_types.values():
        issues.append(
            {
                "code": "MISSING_OUTPUT",
                "node_id": "",
                "message": "At least one Output node required",
            }
        )

    issues.extend(validate_variables(nodes))
    issues.extend(validate_branches(nodes, edges))

    return {"ok": len(cycles) == 0, "issues": issues}
