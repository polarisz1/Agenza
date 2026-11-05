"""AI Gateway 的模型路由（GATE-01）。

只做纯选择逻辑，不读库、不发请求：
- 候选来源由 `modules/gateway/service.py` 转成 `RouteCandidate`
- 预算是否耗尽由 service 计算后传入
"""

from __future__ import annotations

from dataclasses import dataclass, field

# 与 GatewayRoute.task_type 保持一致
TASK_TYPES = ("default", "extract", "long_text", "creative")


@dataclass(frozen=True)
class RouteCandidate:
    """一次路由结果：调用哪个服务商的哪个模型。"""

    provider_id: str
    model: str
    source: str = "primary"  # primary | fallback


class ModelRouter:
    """按 task_type 选择首选/备选模型。

    规则：
    1. 预算硬停机时不再调用模型（返回 None，由 executor 给出明确错误）；
    2. 先查 task_type 对应策略，再退回 `default`；
    3. 服务商未配置/不可用时跳过，落到下一个候选。
    """

    def __init__(
        self,
        routes: dict[str, list[RouteCandidate]] | None = None,
        *,
        budget_exhausted: bool = False,
        available_provider_ids: set[str] | None = None,
    ) -> None:
        self._routes = routes or {}
        self._budget_exhausted = budget_exhausted
        self._available = available_provider_ids

    @property
    def budget_exhausted(self) -> bool:
        return self._budget_exhausted

    def select(self, task_type: str | None = None) -> RouteCandidate | None:
        if self._budget_exhausted:
            return None

        keys = [task_type] if task_type in TASK_TYPES else []
        keys.append("default")
        for key in keys:
            for candidate in self._routes.get(key, ()):
                if not candidate.model:
                    continue
                if self._available is not None and candidate.provider_id not in self._available:
                    continue
                return candidate
        return None


@dataclass
class GatewayRuntime:
    """一次运行/调试使用的 gateway 快照。"""

    router: ModelRouter = field(default_factory=ModelRouter)
    budget_exhausted: bool = False
    budget_message: str | None = None
