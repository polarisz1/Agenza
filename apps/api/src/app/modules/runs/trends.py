"""GATE-04 Phase 3：跨运行诊断趋势。

用确定性规则复用 `build_run_diagnosis`，不调用模型：
- 同类失败 Top N：按 category 聚合窗口内失败节点，给出次数、影响运行数、最近出现；
- 输出质量变化：按天统计已完成运行的「成功率」与「空输出率」。

「空输出率」是质量代理指标：成功节点里输出为 None / 空串 / "null" 的占比，
只统计会产出数据的节点（llm / extract / http / python），避免把 input/output
节点的正常空值算进去。
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta

from sqlalchemy.orm import Session

from app.core.tenancy import get_workspace_id
from app.core.time import utcnow
from app.modules.runs.diagnosis import build_run_diagnosis
from app.modules.runs.models import NodeRun, Run
from app.modules.runs.schemas import (
    DiagnosisCategoryStat,
    DiagnosisTrendPoint,
    RunDiagnosisTrendResponse,
)

# 单次聚合的样本上限：趋势是概览，不追求穷举，避免大租户下拉全表
_MAX_RUNS = 500
_MAX_FAILED_RUNS = 200

_OUTPUT_NODE_TYPES = ("llm", "extract", "http", "python")


def _is_empty_output(value: str | None) -> bool:
    if value is None:
        return True
    text = value.strip()
    return text == "" or text.lower() in {"null", "none"}


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _scope_runs(
    session: Session,
    workflow_id: str | None,
    since: datetime,
) -> list[Run]:
    """已完成、仍在窗口内的运行，最多取最近的 `_MAX_RUNS` 条。"""
    q = session.query(Run).filter(
        Run.deleted_at.is_(None),
        Run.status != "running",
        Run.started_at >= since,
    )
    ws = get_workspace_id()
    if ws is not None:
        q = q.filter(Run.workspace_id == str(ws))
    if workflow_id:
        q = q.filter(Run.workflow_id == workflow_id)
    rows = q.order_by(Run.started_at.desc()).limit(_MAX_RUNS).all()
    return list(reversed(rows))


def _output_rows(
    session: Session,
    workflow_id: str | None,
    since: datetime,
) -> list[tuple[datetime, str | None]]:
    q = (
        session.query(Run.started_at, NodeRun.output_json)
        .join(NodeRun, NodeRun.run_id == Run.id)
        .filter(
            Run.deleted_at.is_(None),
            Run.status != "running",
            Run.started_at >= since,
            NodeRun.deleted_at.is_(None),
            NodeRun.status == "success",
            NodeRun.node_type.in_(_OUTPUT_NODE_TYPES),
        )
    )
    ws = get_workspace_id()
    if ws is not None:
        q = q.filter(Run.workspace_id == str(ws))
    if workflow_id:
        q = q.filter(Run.workflow_id == workflow_id)
    return q.all()


def _top_failures(
    session: Session,
    failed_runs: list[Run],
    top: int,
) -> list[DiagnosisCategoryStat]:
    sample = failed_runs[-_MAX_FAILED_RUNS:]
    if not sample:
        return []

    run_ids = [run.id for run in sample]
    nodes_by_run: dict[str, list[NodeRun]] = defaultdict(list)
    rows = (
        session.query(NodeRun)
        .filter(
            NodeRun.run_id.in_(run_ids),
            NodeRun.deleted_at.is_(None),
            NodeRun.status == "failed",
        )
        .all()
    )
    for node in rows:
        nodes_by_run[node.run_id].append(node)

    stats: dict[str, dict] = {}
    for run in sample:
        for item in build_run_diagnosis(run, nodes_by_run.get(run.id, [])).items:
            entry = stats.setdefault(
                item.category,
                {
                    "title": item.title,
                    "count": 0,
                    "runs": set(),
                    "last_seen": run.started_at,
                    "sample_run_id": run.id,
                    "sample_node_name": item.node_name,
                },
            )
            entry["count"] += 1
            entry["runs"].add(run.id)
            if run.started_at and run.started_at >= entry["last_seen"]:
                entry["title"] = item.title
                entry["last_seen"] = run.started_at
                entry["sample_run_id"] = run.id
                entry["sample_node_name"] = item.node_name

    ordered = sorted(
        stats.items(),
        key=lambda pair: (pair[1]["count"], pair[1]["last_seen"]),
        reverse=True,
    )
    return [
        DiagnosisCategoryStat(
            category=category,
            title=entry["title"],
            count=entry["count"],
            failed_runs=len(entry["runs"]),
            last_seen=entry["last_seen"] or utcnow(),
            sample_run_id=entry["sample_run_id"],
            sample_node_name=entry["sample_node_name"],
        )
        for category, entry in ordered[:top]
    ]


def build_diagnosis_trends(
    session: Session,
    *,
    workflow_id: str | None = None,
    days: int = 30,
    top: int = 5,
) -> RunDiagnosisTrendResponse:
    now = utcnow()
    since = now - timedelta(days=days - 1)
    since = datetime.combine(since.date(), time.min)
    runs = _scope_runs(session, workflow_id, since)

    buckets: dict[str, dict] = {}
    for offset in range(days):
        key = (since.date() + timedelta(days=offset)).isoformat()
        buckets[key] = {"runs": 0, "failed": 0, "outputs": 0, "empty": 0}

    for run in runs:
        key = (run.started_at or now).date().isoformat()
        bucket = buckets.setdefault(key, {"runs": 0, "failed": 0, "outputs": 0, "empty": 0})
        bucket["runs"] += 1
        if run.status == "failed":
            bucket["failed"] += 1

    for started_at, output in _output_rows(session, workflow_id, since):
        key = (started_at or now).date().isoformat()
        bucket = buckets.setdefault(key, {"runs": 0, "failed": 0, "outputs": 0, "empty": 0})
        bucket["outputs"] += 1
        if _is_empty_output(output):
            bucket["empty"] += 1

    points = [
        DiagnosisTrendPoint(
            date=key,
            runs=value["runs"],
            failed=value["failed"],
            success_rate=_rate(value["runs"] - value["failed"], value["runs"]),
            empty_output_rate=_rate(value["empty"], value["outputs"]),
        )
        for key, value in sorted(buckets.items())
    ]

    total_runs = len(runs)
    failed_runs = sum(1 for run in runs if run.status == "failed")
    output_total = sum(value["outputs"] for value in buckets.values())
    output_empty = sum(value["empty"] for value in buckets.values())

    return RunDiagnosisTrendResponse(
        workflow_id=workflow_id,
        days=days,
        period_start=datetime.combine(since.date(), time.min),
        period_end=now,
        total_runs=total_runs,
        failed_runs=failed_runs,
        success_rate=_rate(total_runs - failed_runs, total_runs),
        empty_output_rate=_rate(output_empty, output_total),
        top_failures=_top_failures(
            session,
            [run for run in runs if run.status == "failed"],
            top,
        ),
        points=points,
    )
