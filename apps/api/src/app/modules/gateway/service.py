"""AI Gateway service：预算配置、路由策略、成本与性能统计（GATE-01）。"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.providers.base import ProviderRegistry
from app.core.providers.router import GatewayRuntime, ModelRouter, RouteCandidate
from app.core.time import utcnow
from app.modules.gateway.models import GatewayConfig, GatewayRoute
from app.modules.gateway.repository import GatewayConfigRepository, GatewayRouteRepository
from app.modules.gateway.schemas import (
    GatewayConfigResponse,
    GatewayConfigUpdate,
    GatewayModelStat,
    GatewayRouteItem,
    GatewayRouteUpsert,
    GatewayUsageResponse,
)
from app.modules.runs.service import RunService


def _month_period(now: datetime | None = None) -> tuple[datetime, datetime]:
    end = now or utcnow()
    return end.replace(day=1, hour=0, minute=0, second=0, microsecond=0), end


def _price_map(routes: list[GatewayRoute]) -> dict[str, tuple[float, float]]:
    """model → (input_usd_per_1k, output_usd_per_1k)；首选与备选都纳入。"""
    prices: dict[str, tuple[float, float]] = {}
    for route in routes:
        if route.primary_model:
            prices.setdefault(
                route.primary_model,
                (route.input_price_per_1k or 0.0, route.output_price_per_1k or 0.0),
            )
        if route.fallback_model:
            prices.setdefault(
                route.fallback_model,
                (
                    route.fallback_input_price_per_1k or 0.0,
                    route.fallback_output_price_per_1k or 0.0,
                ),
            )
    return prices


def _to_route_item(route: GatewayRoute) -> GatewayRouteItem:
    return GatewayRouteItem(
        id=route.id,
        task_type=route.task_type,
        label=route.label,
        primary_provider_id=route.primary_provider_id,
        primary_model=route.primary_model,
        fallback_provider_id=route.fallback_provider_id,
        fallback_model=route.fallback_model,
        input_price_per_1k=route.input_price_per_1k or 0.0,
        output_price_per_1k=route.output_price_per_1k or 0.0,
        fallback_input_price_per_1k=route.fallback_input_price_per_1k or 0.0,
        fallback_output_price_per_1k=route.fallback_output_price_per_1k or 0.0,
        enabled=bool(route.enabled),
    )


class GatewayService:
    # ---- 配置 ----

    @staticmethod
    def get_config(session: Session) -> GatewayConfigResponse:
        config = GatewayConfigRepository.get(session)
        return GatewayService._config_response(session, config)

    @staticmethod
    def update_config(session: Session, body: GatewayConfigUpdate) -> GatewayConfigResponse:
        config = GatewayConfigRepository.update(session, body.model_dump(exclude_none=True))
        session.commit()
        return GatewayService._config_response(session, config)

    # ---- 路由策略 ----

    @staticmethod
    def list_routes(session: Session) -> list[GatewayRouteItem]:
        return [_to_route_item(route) for route in GatewayRouteRepository.list(session)]

    @staticmethod
    def upsert_route(session: Session, body: GatewayRouteUpsert) -> GatewayRouteItem:
        route = GatewayRouteRepository.upsert(session, body.model_dump())
        session.commit()
        return _to_route_item(route)

    @staticmethod
    def delete_route(session: Session, route_id: str) -> bool:
        ok = GatewayRouteRepository.delete(session, route_id)
        session.commit()
        return ok

    # ---- 用量 / 成本 ----

    @staticmethod
    def usage(session: Session, days: int = 30) -> GatewayUsageResponse:
        start = utcnow() - timedelta(days=max(1, days))
        return _usage_response(session, start, utcnow())

    # ---- 运行时 ----

    @staticmethod
    def build_runtime(session: Session, registry: ProviderRegistry) -> GatewayRuntime:
        """在发起运行/单节点调试前构建路由与预算快照。"""
        config = GatewayConfigRepository.get(session)
        if config is not None and config.enabled is False:
            return GatewayRuntime()

        routes = GatewayRouteRepository.list(session, enabled_only=True)
        hard_stopped, message = _budget_state(session, config)

        candidates: dict[str, list[RouteCandidate]] = {}
        for route in routes:
            items: list[RouteCandidate] = []
            if route.primary_provider_id:
                items.append(
                    RouteCandidate(
                        provider_id=route.primary_provider_id,
                        model=route.primary_model,
                        source="primary",
                    )
                )
            if route.fallback_provider_id and route.fallback_model:
                items.append(
                    RouteCandidate(
                        provider_id=route.fallback_provider_id,
                        model=route.fallback_model,
                        source="fallback",
                    )
                )
            candidates[route.task_type] = items

        router = ModelRouter(
            candidates,
            budget_exhausted=hard_stopped,
            available_provider_ids=registry.usable_ids(),
        )
        return GatewayRuntime(router=router, budget_exhausted=hard_stopped, budget_message=message)

    @staticmethod
    def resolve(session: Session, task_type: str) -> dict:
        """预览某任务类型当前会选中哪个模型（不含运行）。"""
        from app.modules.providers.service import build_registry

        runtime = GatewayService.build_runtime(session, build_registry(session))
        choice = runtime.router.select(task_type)
        return {
            "task_type": task_type
            if task_type in {"default", "extract", "long_text", "creative"}
            else "default",
            "provider_id": choice.provider_id if choice else None,
            "model": choice.model if choice else None,
            "source": choice.source if choice else None,
            "budget_exhausted": runtime.budget_exhausted,
            "message": runtime.budget_message,
        }

    # ---- 内部 ----

    @staticmethod
    def _config_response(session: Session, config: GatewayConfig | None) -> GatewayConfigResponse:
        start, end = _month_period()
        usage = _usage_response(session, start, end)
        limit = (config.monthly_budget_usd or 0.0) if config else 0.0
        used = round(usage.cost_usd, 6)
        hard_stopped = bool(
            config and config.enabled and config.hard_stop and limit > 0 and used >= limit
        )
        alert_pct = (config.alert_threshold_pct or 80) if config else 80
        alert = bool(config and config.enabled and limit > 0 and used >= limit * alert_pct / 100)
        return GatewayConfigResponse(
            enabled=bool(config.enabled) if config else True,
            monthly_budget_usd=limit,
            alert_threshold_pct=alert_pct,
            hard_stop=bool(config.hard_stop) if config else True,
            used_usd=used,
            remaining_usd=round(limit - used, 6) if limit > 0 else None,
            usage_pct=round(used / limit * 100, 2) if limit > 0 else 0.0,
            alert_triggered=alert,
            hard_stopped=hard_stopped,
            calls=usage.calls,
            tokens_in=usage.tokens_in,
            tokens_out=usage.tokens_out,
            period_start=start,
            period_end=end,
        )


def _budget_state(session: Session, config: GatewayConfig | None) -> tuple[bool, str | None]:
    """返回 (是否硬停机, 给用户看的错误信息)。"""
    if config is None or not config.enabled or not config.hard_stop:
        return False, None
    limit = config.monthly_budget_usd or 0.0
    if limit <= 0:
        return False, None

    start, end = _month_period()
    usage = _usage_response(session, start, end)
    if usage.cost_usd < limit:
        return False, None
    return True, (
        f"月度 AI 预算已用完（已用 ${usage.cost_usd:.2f} / 上限 ${limit:.2f}），"
        "已按硬停机策略停止模型调用"
    )


def _usage_response(session: Session, start: datetime, end: datetime) -> GatewayUsageResponse:
    routes = GatewayRouteRepository.list(session)
    prices = _price_map(routes)
    rows = RunService.usage_by_model(session, start)

    grouped: dict[str, dict] = {}
    for row in rows:
        item = grouped.setdefault(
            row["model"],
            {
                "calls": 0,
                "success": 0,
                "tokens_in": 0,
                "tokens_out": 0,
                "duration_sum": 0.0,
            },
        )
        calls = row["calls"]
        item["calls"] += calls
        if row["status"] == "success":
            item["success"] += calls
        item["tokens_in"] += row["tokens_in"]
        item["tokens_out"] += row["tokens_out"]
        item["duration_sum"] += row["avg_duration_ms"] * calls

    models: list[GatewayModelStat] = []
    total_in = total_out = 0
    total_cost = 0.0
    for model, item in sorted(grouped.items(), key=lambda pair: pair[1]["calls"], reverse=True):
        price_in, price_out = prices.get(model, (0.0, 0.0))
        cost = item["tokens_in"] / 1000 * price_in + item["tokens_out"] / 1000 * price_out
        total_in += item["tokens_in"]
        total_out += item["tokens_out"]
        total_cost += cost
        models.append(
            GatewayModelStat(
                model=model,
                calls=item["calls"],
                success_rate=round(item["success"] / item["calls"], 4) if item["calls"] else 0.0,
                avg_latency_ms=int(item["duration_sum"] / item["calls"]) if item["calls"] else 0,
                tokens_in=item["tokens_in"],
                tokens_out=item["tokens_out"],
                cost_usd=round(cost, 6),
            )
        )

    return GatewayUsageResponse(
        period_start=start,
        period_end=end,
        calls=sum(model.calls for model in models),
        tokens_in=total_in,
        tokens_out=total_out,
        cost_usd=round(total_cost, 6),
        models=models,
    )
