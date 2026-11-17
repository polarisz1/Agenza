"""GATE-04 Phase 2：按需 AI 深度分析（失败根因 + 修复建议）。

设计约束：
- **只在用户点击时调用**，不随页面加载自动产生费用；
- 发送前脱敏（`core/redact.py`），不把密钥/凭据/邮箱交给第三方模型；
- 先查预算硬停机，再选模型；结果按 run 落库兼作缓存，重复点击不重复计费；
- 模型不可用/未配置时返回明确错误，绝不静默降级。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.exceptions import AppError
from app.core.providers.base import ProviderRegistry, describe_http_error
from app.core.redact import redact_text
from app.core.time import utcnow
from app.modules.runs.diagnosis import build_run_diagnosis
from app.modules.runs.models import NodeRun, Run, RunDeepAnalysis
from app.modules.runs.repository import RunDeepAnalysisRepository, RunRepository
from app.modules.runs.schemas import DeepDiagnosisResponse

_MAX_FIELD = 800
_MAX_PROMPT = 6000
_MAX_OUTPUT_TOKENS = 800

_SYSTEM_PROMPT = (
    "你是 Agenza 的工作流运行诊断助手。用户会提供一次失败运行的信息、"
    "失败节点的错误与规则诊断结果。请用简体中文给出简洁、可执行的深度分析，"
    "严格按以下三段输出，不要使用 Markdown 代码块：\n"
    "1) 最可能的根因（一两句话，明确指向具体节点/配置/服务商）\n"
    "2) 判断依据（列出你实际看到的关键证据，不要编造）\n"
    "3) 修复步骤（最多 4 条，按优先级排序，说明改哪里、怎么验证）\n"
    "如果信息不足，请直接说明还缺哪些信息，不要猜测。"
)


@dataclass
class _Prompt:
    system: str
    user: str


def _clip(value: Any, limit: int = _MAX_FIELD) -> str:
    return redact_text(value, limit)


def _format_inputs(run: Run) -> str:
    try:
        inputs = json.loads(run.inputs_json) if run.inputs_json else {}
    except Exception:
        return redact_text(run.inputs_json, _MAX_FIELD)
    return _clip(inputs, _MAX_FIELD)


def build_analysis_prompt(run: Run, nodes: list[NodeRun]) -> _Prompt:
    """把运行快照整理成脱敏后的 prompt；单条超长内容会被截断。"""
    lines: list[str] = [
        "【运行信息】",
        f"工作流：{_clip(run.workflow_name, 200)}",
        f"运行状态：{run.status}",
        f"运行错误：{_clip(run.error) or '（无）'}",
        f"运行输入：{_format_inputs(run)}",
        "",
        "【失败节点】",
    ]

    failed = [node for node in nodes if node.status == "failed"]
    if not failed:
        lines.append("（没有失败节点）")
    for index, node in enumerate(failed, start=1):
        lines.extend(
            [
                f"{index}. {_clip(node.node_name or node.node_id, 120)}"
                f"（{node.node_type or 'unknown'}，模型：{_clip(node.model, 120) or '无'}）",
                f"   错误：{_clip(node.error) or '（无错误信息）'}",
                f"   输出：{_clip(node.output_json) or '（无输出）'}",
            ]
        )

    diagnosis = build_run_diagnosis(run, nodes)
    lines.extend(["", "【规则诊断（确定性结果，供参考）】"])
    if not diagnosis.items:
        lines.append("（没有可诊断项）")
    for item in diagnosis.items:
        # 规则诊断的证据里也可能夹带密钥/邮箱（如节点输出），同样必须脱敏
        evidence = "；".join(
            f"{_clip(evidence.label, 80)}={_clip(evidence.value)}" for evidence in item.evidence
        )
        lines.extend(
            [
                f"- {item.title} [类别 {item.category}，置信度 {item.confidence:.0%}]",
                f"  根因：{_clip(item.root_cause)}",
                f"  证据：{evidence or '无'}",
            ]
        )

    user = "\n".join(lines)
    if len(user) > _MAX_PROMPT:
        user = f"{user[:_MAX_PROMPT]}\n…（内容过长，已截断）"
    return _Prompt(system=_SYSTEM_PROMPT, user=user)


def _resolve_model(session, registry: ProviderRegistry) -> tuple[str, str]:
    """先按 Gateway 路由选模型，未配置路由时退回第一个可用服务商的默认模型。"""
    from app.modules.gateway.service import GatewayService

    runtime = GatewayService.build_runtime(session, registry)
    if runtime.budget_exhausted:
        raise AppError(402, runtime.budget_message or "月度 AI 预算已用完，已停止模型调用")

    choice = runtime.router.select("default")
    if choice is not None and registry.get(choice.provider_id) is not None:
        return choice.provider_id, choice.model

    for provider_id in sorted(registry.usable_ids()):
        adapter = registry.get(provider_id)
        model = getattr(adapter, "default_model", None)
        if model:
            return provider_id, str(model)

    raise AppError(
        400,
        "没有可用的 AI 模型：请先在「AI Gateway」配置路由，或在「模型配置」添加服务商",
    )


def _response(run: Run, row: RunDeepAnalysis, *, cached: bool) -> DeepDiagnosisResponse:
    return DeepDiagnosisResponse(
        run_id=run.id,
        workflow_id=run.workflow_id,
        status=run.status,
        analysis=row.content,
        provider_id=row.provider_id,
        model=row.model,
        tokens_in=row.tokens_in or 0,
        tokens_out=row.tokens_out or 0,
        cached=cached,
        # refresh 会覆盖旧结果，用 updated_at 才能反映最近一次生成时间
        generated_at=row.updated_at or row.created_at or utcnow(),
    )


class DeepAnalysisService:
    @staticmethod
    async def analyze(
        session,
        run_id: str,
        *,
        refresh: bool = False,
        registry: ProviderRegistry | None = None,
    ) -> DeepDiagnosisResponse:
        """生成（或读取缓存的）深度分析；`registry` 仅用于测试注入 mock 模型。"""
        run = RunRepository.get(session, run_id)
        if run is None:
            raise AppError(404, "Run not found")
        if run.status == "running":
            raise AppError(409, "运行尚未结束，结束后再进行 AI 深度分析")

        cached_row = RunDeepAnalysisRepository.get_by_run(session, run_id)
        if cached_row is not None and not refresh:
            return _response(run, cached_row, cached=True)

        if registry is None:
            from app.modules.providers.service import build_registry

            registry = build_registry(session)

        provider_id, model = _resolve_model(session, registry)
        adapter = registry.get(provider_id)
        if adapter is None:
            raise AppError(400, f"服务商不可用（{provider_id}）：请到「模型配置」检查")

        nodes = RunRepository.list_node_runs(session, run_id)
        prompt = build_analysis_prompt(run, nodes)

        try:
            result = await adapter.chat(
                model=model,
                system=prompt.system,
                user=prompt.user,
                temperature=0.2,
                max_tokens=_MAX_OUTPUT_TOKENS,
                response_format="text",
            )
        except httpx.HTTPStatusError as exc:
            raise AppError(502, describe_http_error(exc)) from exc
        except httpx.TimeoutException as exc:
            raise AppError(504, "模型服务超时：请稍后重试") from exc
        except httpx.ConnectError as exc:
            raise AppError(502, "无法连接到模型服务地址") from exc
        except Exception as exc:
            raise AppError(502, f"AI 深度分析调用失败：{exc}") from exc

        content = (
            result.content
            if isinstance(result.content, str)
            else json.dumps(result.content, ensure_ascii=False)
        ).strip()
        row = RunDeepAnalysisRepository.upsert(
            session,
            run_id,
            {
                "provider_id": provider_id,
                "model": result.model or model,
                "content": content or "模型没有返回分析内容，请重试。",
                "tokens_in": result.tokens_in or 0,
                "tokens_out": result.tokens_out or 0,
            },
        )
        session.commit()
        return _response(run, row, cached=False)
