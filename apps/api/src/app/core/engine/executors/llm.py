"""LLM executor - delegates to providers registry."""
from __future__ import annotations

import httpx

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor
from app.core.providers.base import describe_http_error


class LLMExecutor(BaseExecutor):
    node_type = "llm"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        provider_id = config.get("provider_id")
        if not provider_id or ctx.providers is None:
            return NodeResult(status="failed", error="服务商未配置：请到「模型配置」添加并选择服务商")

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
            result = await provider.chat(
                model=config.get("model"),
                system=system,
                user=prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format="json" if config.get("format") == "json" else "text",
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
        except Exception as exc:  # noqa: BLE001
            return NodeResult(status="failed", error=str(exc))
