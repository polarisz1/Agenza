"""HTTP executor - asyncio-friendly HTTP requests via httpx."""
from __future__ import annotations

import asyncio

import httpx

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor
from app.core.net import trust_env_for


class HttpExecutor(BaseExecutor):
    node_type = "http"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        url = config.get("url", "")
        method = config.get("method", "GET").upper()
        headers = config.get("headers", {})
        body = config.get("body")
        timeout = config.get("timeout_s", 30)

        try:
            async with httpx.AsyncClient(
                timeout=timeout, trust_env=trust_env_for(url)
            ) as client:
                if method == "GET":
                    resp = await client.get(url, headers=headers)
                elif method == "POST":
                    resp = await client.post(url, headers=headers, content=body)
                elif method == "PUT":
                    resp = await client.put(url, headers=headers, content=body)
                elif method == "DELETE":
                    resp = await client.delete(url, headers=headers)
                else:
                    return NodeResult(status="failed", error=f"Unsupported method: {method}")
        except httpx.TimeoutException:
            return NodeResult(status="failed", error=f"请求超时（{timeout}s）")
        except httpx.ConnectError:
            return NodeResult(status="failed", error="无法连接到目标地址")
        except httpx.RequestError as exc:
            return NodeResult(status="failed", error=f"请求失败：{exc}")

        text = resp.text
        try:
            import json
            body_out = json.loads(text)
        except Exception:
            body_out = text

        return NodeResult(
            status="success" if resp.is_success else "failed",
            output={
                "status": resp.status_code,
                "headers": dict(resp.headers),
                "body": body_out,
            },
            error=None if resp.is_success else f"HTTP {resp.status_code}: {resp.reason_phrase}",
        )
