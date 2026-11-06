"""GATE-04：运行失败的确定性根因分析。

只依据已落库的数据（错误文本、节点输出、节点配置）做规则推断，不调用模型：
1. 规则按顺序匹配，越具体越靠前；
2. 每条结果都给出「类别 + 根因 + 证据 + 可执行建议」；
3. 证据不足时返回 unknown，并明确说明无法判断，绝不编造原因。
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.core.engine.executors.extract import parse_fields
from app.core.time import utcnow
from app.modules.runs.models import NodeRun, Run
from app.modules.runs.schemas import (
    DiagnosisCategory,
    DiagnosisEvidence,
    DiagnosisSuggestion,
    NodeDiagnosis,
    RunDiagnosisResponse,
)

_EVIDENCE_CLIP = 800


def _clip(value: Any, limit: int = _EVIDENCE_CLIP) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    text = text.strip()
    return text if len(text) <= limit else f"{text[:limit]}…（已截断）"


def _evidence(label: str, value: Any) -> DiagnosisEvidence:
    return DiagnosisEvidence(label=label, value=_clip(value))


def _suggestion(text: str, action: str | None = None) -> DiagnosisSuggestion:
    return DiagnosisSuggestion(text=text, action=action)


def _matched_fields(error: str) -> list[str]:
    match = re.search(r"缺少字段[:：]\s*(.+)", error)
    if not match:
        return []
    return [item.strip() for item in re.split(r"[、,，]", match.group(1)) if item.strip()]


def _expected_fields(config: dict) -> list[str]:
    if (config.get("type") or "") == "extract" or config.get("fields_text"):
        return [field["name"] for field in parse_fields(config.get("fields_text", ""))]
    return []


def _classify(
    error: str, config: dict, output: Any
) -> tuple[
    DiagnosisCategory,
    str,
    str,
    float,
    list[DiagnosisSuggestion],
    list[DiagnosisEvidence],
]:
    """返回 (category, title, root_cause, confidence, suggestions, extra_evidence)。"""
    text = (error or "").strip()
    output_text = _clip(output) if output is not None else ""

    # ── 预算硬停机 ──
    if re.search(r"预算|budget", text, re.I):
        return (
            "budget",
            "AI 预算已用完",
            "本月 AI 成本达到预算上限，Gateway 按硬停机策略拒绝调用模型。",
            0.95,
            [
                _suggestion("到 AI Gateway 调高月度预算，或关闭硬停机后重试", "open_gateway"),
                _suggestion("检查高消耗节点与路由单价，确认预算口径", "open_gateway"),
            ],
            [],
        )

    # ── 鉴权 ──
    if re.search(r"鉴权|401|403|api[ _-]?key|密钥|decrypt|unauthorized", text, re.I):
        return (
            "auth",
            "服务商鉴权失败",
            "服务商拒绝了请求：密钥缺失、错误、过期或无法解密。",
            0.95,
            [
                _suggestion("到「模型配置」重新填写密钥并点「测试」", "open_models"),
                _suggestion("确认该服务商仍处于启用状态后重试", "retry_node"),
            ],
            [],
        )

    # ── 限流 ──
    if re.search(r"限流|429", text, re.I):
        return (
            "rate_limit",
            "服务商限流",
            "调用频率或并发超过服务商配额（HTTP 429）。",
            0.9,
            [
                _suggestion("稍后重试，或降低运行并发", "retry_node"),
                _suggestion("在 Gateway 给该任务类型配置备选模型做自动降级", "open_gateway"),
            ],
            [],
        )

    # ── 超时 ──
    if re.search(r"超时|timeout|timed out", text, re.I):
        timeout = config.get("timeout")
        evidence = []
        if timeout is not None:
            evidence.append(_evidence("节点超时设置", f"{timeout}s"))
        return (
            "timeout",
            "执行超时",
            "节点在超时时间内没有完成：模型/接口响应过慢，或超时设置过小。",
            0.9,
            [
                _suggestion("调大该节点的「超时（秒）」后重试", "open_node"),
                _suggestion("换更快的模型，或把长任务拆成多个节点", "open_node"),
            ],
            evidence,
        )

    # ── 网络 ──
    if re.search(
        r"无法连接|连接失败|connection|connecterror|network|dns|502|503|504|proxy", text, re.I
    ):
        return (
            "network",
            "网络连接失败",
            "无法建立到服务商或外部接口的网络连接。",
            0.9,
            [
                _suggestion("检查服务商地址、网络与代理设置", "open_models"),
                _suggestion("本地服务（如 Ollama）确认已启动并监听对应端口", "open_models"),
            ],
            [],
        )

    # ── Gateway 无可用模型 ──
    if re.search(r"ai gateway 未找到可用模型|未找到可用模型", text, re.I):
        return (
            "provider",
            "没有可用模型",
            "当前路由策略没有匹配到可用服务商：策略为空、服务商被停用或密钥不可用。",
            0.9,
            [
                _suggestion("检查 AI Gateway 的路由策略与服务商状态", "open_gateway"),
                _suggestion("确认节点已选择服务商，或开启 routing=auto", "open_node"),
            ],
            [],
        )

    # ── 服务商配置 ──
    if re.search(r"服务商|provider|unsupported kind|no executor", text, re.I):
        provider_id = config.get("provider_id")
        evidence = [_evidence("节点服务商", provider_id)] if provider_id else []
        return (
            "provider",
            "服务商不可用",
            "节点指向的服务商不存在、已停用，或其类型不受支持。",
            0.85,
            [
                _suggestion("到「模型配置」确认服务商存在且已启用", "open_models"),
                _suggestion("重新选择该节点的服务商后重试", "open_node"),
            ],
            evidence,
        )

    # ── 模型/接口不存在 ──
    if re.search(r"模型或接口不存在|404|model.?not.?found", text, re.I):
        return (
            "model_not_found",
            "模型或接口不存在",
            "服务商找不到请求的模型或接口：模型名、服务地址可能填错。",
            0.9,
            [
                _suggestion("核对模型名与服务商 base_url", "open_models"),
                _suggestion("用「测试」验证服务商可用后重试", "retry_node"),
            ],
            [],
        )

    # ── JSON 格式 ──
    if re.search(r"json parse failed|抽取结果不是 json 对象|not valid json", text, re.I):
        root = (
            "模型输出被 Markdown 代码块或其他文字包裹，抽取节点只接受纯 JSON。"
            if "```" in output_text
            else "模型输出不是合法 JSON：可能夹带解释文字、前后缀或多段内容。"
        )
        return (
            "json_format",
            "模型返回了非纯 JSON",
            root,
            0.95,
            [
                _suggestion(
                    "在系统提示词中要求「只输出 JSON，不要 Markdown 代码块或解释」",
                    "edit_prompt",
                ),
                _suggestion("在抽取节点前加一个 Python 节点清洗输出", "open_node"),
                _suggestion("重试一次；仍失败可换更稳定的模型", "retry_node"),
            ],
            [],
        )

    # ── 缺失字段 ──
    missing = _matched_fields(text)
    if missing or re.search(r"缺少字段", text):
        return (
            "missing_fields",
            "抽取结果缺少字段",
            f"模型返回了 JSON，但没有包含配置要求的字段：{'、'.join(missing) or '未知'}。",
            0.95,
            [
                _suggestion("在提示词中明确列出全部字段及含义", "edit_prompt"),
                _suggestion("检查字段名拼写与「目标字段」配置是否一致", "open_node"),
                _suggestion("重试一次，或换指令遵循更好的模型", "retry_node"),
            ],
            [],
        )

    # ── 变量解析 ──
    if re.search(r"变量|variable|missing key|unknown variable|unknown field", text, re.I):
        return (
            "variable",
            "变量解析失败",
            "模板引用的节点/字段不存在，或上游节点被跳过导致数据缺失。",
            0.85,
            [
                _suggestion("检查 {{ 节点.字段 }} 的节点名与字段名", "open_node"),
                _suggestion("确认上游节点没有被分支跳过或禁用", "open_node"),
            ],
            [],
        )

    # ── 脚本 ──
    if re.search(r"脚本|script|agentflow_result|子进程|syntaxerror|empty script", text, re.I):
        return (
            "script",
            "脚本执行失败",
            "Python 脚本以非 0 退出码结束，或没有通过 agentflow_result 返回结果。",
            0.9,
            [
                _suggestion("检查脚本是否给 agentflow_result 赋值", "open_node"),
                _suggestion("查看错误里的 stderr，用「调试此节点」单独执行", "retry_node"),
            ],
            [],
        )

    # ── 上游/分支 ──
    if re.search(r"upstream|上游|分支未激活|节点未产生结果", text, re.I):
        return (
            "upstream",
            "上游节点未产出",
            "上游节点失败或被跳过，当前节点没有拿到执行所需的输入。",
            0.8,
            [
                _suggestion("先修复上游失败节点，再重跑本次运行", "open_node"),
                _suggestion("检查条件节点的真假分支连线是否符合预期", "open_node"),
            ],
            [],
        )

    # ── 内部异常 ──
    if re.search(r"节点执行异常|notimplemented|traceback|internal|无错误信息", text, re.I):
        return (
            "internal",
            "内部执行异常",
            "节点执行过程中抛出了未分类异常，属于程序内部错误。",
            0.6,
            [
                _suggestion("重试一次，确认是否稳定复现", "retry_node"),
                _suggestion("复制完整错误信息反馈给维护者", None),
            ],
            [],
        )

    # ── 兜底 ──
    if text:
        return (
            "unknown",
            "运行失败",
            "错误文本未命中已知模式，暂时无法自动判断根因。",
            0.3,
            [
                _suggestion("展开节点查看输入与输出，必要时用「调试此节点」单独执行", "open_node"),
                _suggestion("复制错误信息，便于进一步定位", None),
            ],
            [],
        )

    return (
        "unknown",
        "运行失败（无错误文本）",
        "节点失败但没有记录错误信息，无法自动判断根因。",
        0.2,
        [
            _suggestion("查看节点输入与输出是否为空", "open_node"),
            _suggestion("重试一次；仍失败请反馈完整运行记录", "retry_node"),
        ],
        [],
    )


def _node_evidence(node: NodeRun, config: dict) -> list[DiagnosisEvidence]:
    evidence: list[DiagnosisEvidence] = []
    if node.error:
        evidence.append(_evidence("错误信息", node.error))
    if node.model:
        evidence.append(_evidence("模型", node.model))
    if node.output_json:
        evidence.append(_evidence("节点输出", node.output_json))
    fields = _expected_fields(config)
    if fields:
        evidence.append(_evidence("期望字段", "、".join(fields)))
    return evidence


def diagnose_node(node: NodeRun, config: dict) -> NodeDiagnosis:
    category, title, root_cause, confidence, suggestions, extra = _classify(
        node.error or "", config, node.output_json
    )
    evidence = _node_evidence(node, config) + extra
    return NodeDiagnosis(
        node_id=node.node_id,
        node_name=node.node_name or node.node_id,
        node_type=node.node_type or "unknown",
        status=node.status,
        category=category,
        severity="blocking",
        title=title,
        root_cause=root_cause,
        confidence=confidence,
        evidence=evidence,
        suggestions=suggestions,
    )


def _node_configs(run: Run) -> dict[str, dict]:
    try:
        graph = json.loads(run.graph_snapshot or "{}")
    except Exception:
        return {}
    return {
        str(node.get("id")): node.get("config") or {}
        for node in graph.get("nodes", [])
        if node.get("id")
    }


def build_run_diagnosis(run: Run, nodes: list[NodeRun]) -> RunDiagnosisResponse:
    configs = _node_configs(run)
    failed = [node for node in nodes if node.status == "failed"]
    failed_ids = {node.node_id for node in failed}
    items = []
    for node in failed:
        # 子工作流父节点失败时，若子节点已有失败诊断，则只保留更具体的子节点条目，
        # 避免「子工作流失败 + 子节点失败」重复出现（TRIGGER-02 Phase B）。
        if node.node_type == "subworkflow" and any(
            child_id.startswith(f"{node.node_id}/") for child_id in failed_ids
        ):
            continue
        items.append(diagnose_node(node, configs.get(node.node_id, {})))

    # 启动即失败等场景没有失败节点：补一条运行级诊断，避免诊断页空白
    if not items and run.status == "failed":
        category, title, root_cause, confidence, suggestions, _extra = _classify(
            run.error or "", {}, None
        )
        items.append(
            NodeDiagnosis(
                node_id="",
                node_name="运行",
                node_type="run",
                status=run.status,
                category=category,
                severity="blocking",
                title=title,
                root_cause=root_cause,
                confidence=confidence,
                evidence=[_evidence("运行错误", run.error or "（无错误信息）")],
                suggestions=suggestions,
            )
        )

    return RunDiagnosisResponse(
        run_id=run.id,
        workflow_id=run.workflow_id,
        status=run.status,
        generated_at=utcnow(),
        items=items,
    )
