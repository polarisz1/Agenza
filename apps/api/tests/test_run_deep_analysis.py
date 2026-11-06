"""GATE-04 Phase 2：AI 深度分析（预算 / 缓存 / 脱敏，mock 模型不联网）。"""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.exceptions import AppError
from app.core.providers.base import ChatResult, ProviderAdapter, ProviderRegistry
from app.core.providers.router import GatewayRuntime, ModelRouter
from app.core.redact import redact_text
from app.core.time import utcnow
from app.db.database import SessionLocal
from app.main import app
from app.modules.gateway.service import GatewayService
from app.modules.runs.deep_analysis import DeepAnalysisService, build_analysis_prompt
from app.modules.runs.models import NodeRun, Run, RunDeepAnalysis
from app.modules.runs.repository import RunRepository


class FakeProvider(ProviderAdapter):
    """记录调用次数的假模型，确保测试绝不访问网络。"""

    kind = "fake"

    def __init__(self) -> None:
        self.default_model = "mock-model"
        self.calls = 0
        self.last_user = ""

    async def chat(
        self,
        *,
        model: str | None = None,
        system: str = "",
        user: str = "",
        temperature: float = 0.7,
        max_tokens: int = 2048,
        response_format: str = "text",
    ) -> ChatResult:
        self.calls += 1
        self.last_user = user
        return ChatResult(
            content="1) 根因：脚本为空\n2) 依据：错误信息为 Empty script\n3) 修复：补全脚本并重跑",
            model=model or self.default_model,
            tokens_in=120,
            tokens_out=60,
        )


def _insert_run(
    session,
    *,
    nodes: list[dict] | None = None,
    status: str = "failed",
    run_error: str | None = "Empty script",
) -> str:
    run_id = f"run_deep_{uuid4().hex[:8]}"
    graph = {"version": 1, "inputs": [], "nodes": [], "edges": []}
    session.add(
        Run(
            id=run_id,
            workflow_id="wf_deep",
            workflow_name="深度分析用例",
            graph_snapshot=json.dumps(graph, ensure_ascii=False),
            inputs_json=json.dumps({"topic": "hello"}, ensure_ascii=False),
            status=status,
            trigger="manual",
            error=run_error,
            started_at=utcnow(),
        )
    )
    for index, node in enumerate(nodes or []):
        session.add(
            NodeRun(
                id=f"nr_{uuid4().hex[:8]}",
                run_id=run_id,
                node_id=node.get("node_id", f"n{index}"),
                node_type=node.get("node_type", "python"),
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
    session.query(RunDeepAnalysis).filter(RunDeepAnalysis.run_id == run_id).delete(
        synchronize_session=False
    )
    session.query(Run).filter(Run.id == run_id).delete(synchronize_session=False)
    session.commit()


def _use_empty_gateway(monkeypatch) -> None:
    """隔离 dev 库里的 Gateway 配置，让用例只走"第一个可用服务商"这条回退路径。"""
    monkeypatch.setattr(GatewayService, "build_runtime", lambda *args, **kwargs: GatewayRuntime())


def test_deep_analysis_caches_and_uses_mock_model(monkeypatch) -> None:
    _use_empty_gateway(monkeypatch)
    with SessionLocal() as session:
        run_id = _insert_run(
            session,
            nodes=[
                {
                    "node_id": "n_py",
                    "node_name": "失败脚本",
                    "error": "Empty script",
                    "output_json": '{"ok": false}',
                }
            ],
        )
        fake = FakeProvider()
        registry = ProviderRegistry()
        registry.register("p_mock", fake)
        try:
            first = asyncio.run(DeepAnalysisService.analyze(session, run_id, registry=registry))
            assert first.cached is False
            assert "根因" in first.analysis
            assert first.model == "mock-model"
            assert (first.tokens_in, first.tokens_out) == (120, 60)
            assert fake.calls == 1

            second = asyncio.run(DeepAnalysisService.analyze(session, run_id, registry=registry))
            assert second.cached is True
            assert second.analysis == first.analysis
            assert fake.calls == 1  # 命中缓存，不再调用模型

            refreshed = asyncio.run(
                DeepAnalysisService.analyze(session, run_id, refresh=True, registry=registry)
            )
            assert refreshed.cached is False
            assert fake.calls == 2

            # 同一 run 只保留一条；Token 进入 Gateway 用量口径
            stored = session.query(RunDeepAnalysis).filter(RunDeepAnalysis.run_id == run_id).all()
            assert len(stored) == 1
            assert stored[0].tokens_in == 120
        finally:
            _cleanup(session, run_id)


def test_deep_analysis_blocks_on_budget_hard_stop(monkeypatch) -> None:
    # 预算计算本身由 test_gateway 覆盖；这里只验证深度分析确实先看预算再调模型
    exhausted = GatewayRuntime(
        router=ModelRouter(budget_exhausted=True),
        budget_exhausted=True,
        budget_message="月度 AI 预算已用完（已用 $1.00 / 上限 $1.00），已按硬停机策略停止模型调用",
    )
    monkeypatch.setattr(GatewayService, "build_runtime", lambda *args, **kwargs: exhausted)

    with SessionLocal() as session:
        run_id = _insert_run(session, nodes=[{"error": "Empty script"}])
        fake = FakeProvider()
        registry = ProviderRegistry()
        registry.register("p_mock", fake)
        try:
            with pytest.raises(AppError) as exc:
                asyncio.run(DeepAnalysisService.analyze(session, run_id, registry=registry))
            assert exc.value.code == 402
            assert "预算" in exc.value.message
            assert fake.calls == 0
        finally:
            _cleanup(session, run_id)


def test_deep_analysis_reports_missing_model(monkeypatch) -> None:
    _use_empty_gateway(monkeypatch)
    with SessionLocal() as session:
        run_id = _insert_run(session, nodes=[{"error": "Empty script"}])
        try:
            with pytest.raises(AppError) as exc:
                asyncio.run(
                    DeepAnalysisService.analyze(session, run_id, registry=ProviderRegistry())
                )
            assert exc.value.code == 400
            assert "模型" in exc.value.message
        finally:
            _cleanup(session, run_id)


def test_deep_analysis_prompt_redacts_secrets() -> None:
    with SessionLocal() as session:
        run_id = _insert_run(
            session,
            nodes=[
                {
                    "node_id": "n_auth",
                    "node_type": "llm",
                    "error": "鉴权失败：api_key=sk-abcdef1234567890，联系 alice@example.com",
                }
            ],
        )
        try:
            run = RunRepository.get(session, run_id)
            nodes = RunRepository.list_node_runs(session, run_id)
            prompt = build_analysis_prompt(run, nodes)
            assert "sk-abcdef1234567890" not in prompt.user
            assert "alice@example.com" not in prompt.user
            assert "api_key=***" in prompt.user
            assert "a***@example.com" in prompt.user
        finally:
            _cleanup(session, run_id)


def test_redact_text_masks_common_secret_shapes() -> None:
    text = (
        "Authorization: Bearer abcdefghijklmnop\n"
        "token=supersecret123\n"
        "https://user:pass@example.com/api\n"
        "sk-proj-1234567890abcdef"
    )
    masked = redact_text(text)
    assert "abcdefghijklmnop" not in masked
    assert "supersecret123" not in masked
    assert "user:pass@" not in masked
    assert "sk-proj-1234567890abcdef" not in masked
    assert "***" in masked


def test_deep_analysis_endpoint_returns_404_for_missing_run() -> None:
    with TestClient(app) as client:
        response = client.post("/api/runs/run_missing/diagnosis/deep")
    assert response.status_code == 404
