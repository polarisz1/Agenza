"""GATE-01：ModelRouter、路由策略、预算与用量统计回归。"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.engine.contexts import NodeContext
from app.core.engine.executors.llm import LLMExecutor
from app.core.providers.base import ChatResult, ProviderRegistry
from app.core.providers.router import ModelRouter, RouteCandidate
from app.core.time import utcnow
from app.db.database import SessionLocal
from app.main import app
from app.modules.runs.models import NodeRun


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


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── ModelRouter 纯逻辑 ──────────────────────────────────────────────


def test_model_router_prefers_primary_then_fallback() -> None:
    routes = {
        "default": [
            RouteCandidate(provider_id="p1", model="fast", source="primary"),
            RouteCandidate(provider_id="p2", model="backup", source="fallback"),
        ],
        "extract": [
            RouteCandidate(provider_id="p3", model="precise", source="primary"),
        ],
    }
    router = ModelRouter(routes, available_provider_ids={"p1", "p2", "p3"})
    assert router.select("default").model == "fast"
    assert router.select("extract").model == "precise"
    # 未知 task_type 回退 default
    assert router.select("unknown").model == "fast"

    # 首选服务商不可用 → 落到备选
    fallback = ModelRouter(routes, available_provider_ids={"p2", "p3"})
    choice = fallback.select("default")
    assert choice is not None and choice.model == "backup" and choice.source == "fallback"

    # 全部不可用 / 预算停机 → None
    assert ModelRouter(routes, available_provider_ids=set()).select("default") is None
    assert ModelRouter(routes, budget_exhausted=True).select("default") is None


# ── 配置与路由 API ─────────────────────────────────────────────────


def test_gateway_config_and_route_api(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    with TestClient(app) as client:
        token, _ws = _register(client, "gw-config")
        headers = _headers(token)

        initial = client.get("/api/v1/gateway/config", headers=headers)
        assert initial.status_code == 200, initial.text
        assert initial.json()["data"]["monthly_budget_usd"] == 0

        updated = client.put(
            "/api/v1/gateway/config",
            headers=headers,
            json={
                "monthly_budget_usd": 12.5,
                "alert_threshold_pct": 70,
                "hard_stop": False,
            },
        )
        assert updated.status_code == 200, updated.text
        data = updated.json()["data"]
        assert data["monthly_budget_usd"] == 12.5
        assert data["alert_threshold_pct"] == 70
        assert data["hard_stop"] is False
        assert data["remaining_usd"] == 12.5

        created = client.post(
            "/api/v1/gateway/routes",
            headers=headers,
            json={
                "task_type": "default",
                "label": "默认",
                "primary_provider_id": "pv_a",
                "primary_model": "model-a",
                "fallback_provider_id": "pv_b",
                "fallback_model": "model-b",
                "input_price_per_1k": 0.5,
                "output_price_per_1k": 1.5,
            },
        )
        assert created.status_code == 200, created.text
        route_id = created.json()["data"]["id"]

        # 同 task_type upsert：不产生第二条
        client.post(
            "/api/v1/gateway/routes",
            headers=headers,
            json={
                "task_type": "default",
                "primary_provider_id": "pv_a",
                "primary_model": "model-a2",
            },
        )
        listed = client.get("/api/v1/gateway/routes", headers=headers)
        items = listed.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["primary_model"] == "model-a2"

        deleted = client.delete(f"/api/v1/gateway/routes/{route_id}", headers=headers)
        assert deleted.status_code == 200, deleted.text
        assert client.get("/api/v1/gateway/routes", headers=headers).json()["data"]["items"] == []

        # 未知路由删除
        assert (
            client.delete("/api/v1/gateway/routes/gw_missing", headers=headers).status_code == 404
        )


# ── 用量 / 成本 / 预算硬停机 ───────────────────────────────────────


def test_gateway_usage_and_budget_hard_stop(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TENANCY_ENABLED", True)
    run_id = f"run_gw_{uuid4().hex[:8]}"
    inserted: list[str] = []

    with TestClient(app) as client:
        token, workspace_id = _register(client, "gw-usage")
        headers = _headers(token)

        # 路由单价：model-a → $1/1K in + $2/1K out
        client.post(
            "/api/v1/gateway/routes",
            headers=headers,
            json={
                "task_type": "default",
                "primary_provider_id": "pv_a",
                "primary_model": "model-a",
                "input_price_per_1k": 1.0,
                "output_price_per_1k": 2.0,
            },
        )

        with SessionLocal() as session:
            for index in range(2):
                node_id = f"gw_node_{uuid4().hex[:8]}"
                inserted.append(node_id)
                session.add(
                    NodeRun(
                        id=node_id,
                        workspace_id=workspace_id,
                        run_id=run_id,
                        node_id=f"n{index}",
                        node_type="llm",
                        node_name="LLM",
                        status="success" if index == 0 else "failed",
                        model="model-a",
                        tokens_in=1000,
                        tokens_out=1000,
                        duration_ms=2000 if index == 0 else 4000,
                        started_at=utcnow(),
                    )
                )
            session.commit()

        usage = client.get("/api/v1/gateway/usage?days=30", headers=headers)
        assert usage.status_code == 200, usage.text
        data = usage.json()["data"]
        # 两次调用：in 2000 + out 2000 → 2*1 + 2*2 = 6 USD
        assert data["cost_usd"] == 6.0
        assert data["calls"] == 2
        assert data["models"][0]["model"] == "model-a"
        assert data["models"][0]["success_rate"] == 0.5
        assert data["models"][0]["avg_latency_ms"] == 3000

        # 预算 6 → 恰好用满，触发告警与硬停机
        client.put(
            "/api/v1/gateway/config",
            headers=headers,
            json={"monthly_budget_usd": 6, "alert_threshold_pct": 80, "hard_stop": True},
        )
        config = client.get("/api/v1/gateway/config", headers=headers).json()["data"]
        assert config["used_usd"] == 6.0
        assert config["usage_pct"] == 100.0
        assert config["alert_triggered"] is True
        assert config["hard_stopped"] is True

        resolved = client.get("/api/v1/gateway/resolve?task_type=default", headers=headers)
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["data"]["budget_exhausted"] is True

        # 提高预算 → 恢复
        client.put(
            "/api/v1/gateway/config",
            headers=headers,
            json={"monthly_budget_usd": 100},
        )
        config = client.get("/api/v1/gateway/config", headers=headers).json()["data"]
        assert config["hard_stopped"] is False
        assert config["alert_triggered"] is False

    with SessionLocal() as session:
        session.query(NodeRun).filter(NodeRun.id.in_(inserted)).delete(synchronize_session=False)
        session.commit()


# ── 执行器接入：预算停机 + 自动路由 ────────────────────────────────


class FakeProvider:
    def __init__(self) -> None:
        self.models: list[str | None] = []

    async def chat(self, *, model=None, **kwargs) -> ChatResult:
        self.models.append(model)
        return ChatResult(content="ok", model=model or "fake", tokens_in=1, tokens_out=1)


def test_llm_executor_respects_budget_and_auto_routing() -> None:
    provider = FakeProvider()
    registry = ProviderRegistry()
    registry.register("pv_a", provider)

    blocked = NodeContext(
        node={"id": "n", "type": "llm", "config": {}},
        run_inputs={},
        providers=registry,
        budget_exhausted=True,
        budget_message="预算已用完",
    )
    result = asyncio.run(LLMExecutor().execute(blocked))
    assert result.status == "failed"
    assert result.error == "预算已用完"
    assert provider.models == []

    router = ModelRouter(
        {"default": [RouteCandidate(provider_id="pv_a", model="routed-model")]},
        available_provider_ids={"pv_a"},
    )
    ctx = NodeContext(
        node={"id": "n", "type": "llm", "config": {"routing": "auto"}},
        run_inputs={},
        providers=registry,
        model_router=router,
    )
    result = asyncio.run(LLMExecutor().execute(ctx))
    assert result.status == "success", result.error
    assert provider.models == ["routed-model"]
    assert result.model == "routed-model"
