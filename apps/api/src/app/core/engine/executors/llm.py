"""LLM executor - delegates to providers registry (with optional AI Gateway routing)."""

from __future__ import annotations

import httpx

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor
from app.core.providers.base import describe_http_error


def _route_task_type(node_type: str | None, config: dict) -> str:
    """推断路由任务类型；节点可用 `route_task_type` 显式覆盖。"""
    explicit = config.get("route_task_type")
    if explicit in {"default", "extract", "long_text", "creative"}:
        return str(explicit)
    if node_type == "extract" or config.get("format") == "json":
        return "extract"
    return "default"


class LLMExecutor(BaseExecutor):
    node_type = "llm"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        # GATE-01：预算硬停机时不再发起模型调用
        if ctx.budget_exhausted:
            return NodeResult(
                status="failed",
                error=ctx.budget_message or "月度 AI 预算已用完，已停止模型调用",
            )

        provider_id = config.get("provider_id")
        model = config.get("model")

        # GATE-01：显式开启自动路由时，由 ModelRouter 决定 provider/model
        if config.get("routing") == "auto" and ctx.model_router is not None:
            choice = ctx.model_router.select(
                _route_task_type(ctx.node.get("type"), config)
            )
            if choice is None:
                return NodeResult(
                    status="failed",
                    error="AI Gateway 未找到可用模型：请检查路由策略与服务商配置",
                )
            provider_id, model = choice.provider_id, choice.model

        if not provider_id or ctx.providers is None:
            return NodeResult(
                status="failed", error="服务商未配置：请到「模型配置」添加并选择服务商"
            )

        provider = ctx.providers.get(provider_id)
        if provider is None:
            return NodeResult(
                status="failed",
                error=f"服务商未找到或已停用（{provider_id}）：请到「模型配置」检查",
            )

        system = config.get("system", "")
        prompt = config.get("prompt", "")
        temperature = config.get("temperature", 0.7)
        max_tokens = config.get("max_tokens", 2048)

        try:
            # 有增量回调就走流式；没有（单节点调试等）保持一次性返回
            use_stream = ctx.on_delta is not None and hasattr(provider, "stream")
            call = provider.stream if use_stream else provider.chat
            result = await call(
                model=model,
                system=system,
                user=prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format="json" if config.get("format") == "json" else "text",
                **({"on_delta": ctx.on_delta} if use_stream else {}),
            )
            return NodeResult(
                status="success",
                output=result.content,
                model=result.model,
                tokens_in=result.tokens_in,
                tokens_out=result.tokens_out,
            )
        except httpx.HTTPStatusError as exc:
            return NodeResult(status="failed", error=describe_http_error(exc))
        except httpx.TimeoutException:
            return NodeResult(status="failed", error="模型服务超时")
        except httpx.ConnectError:
            return NodeResult(status="failed", error="无法连接到模型服务地址")
        except Exception as exc:
            return NodeResult(status="failed", error=str(exc))
