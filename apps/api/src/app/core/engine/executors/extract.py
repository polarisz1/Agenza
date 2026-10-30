"""结构化抽取：把「目标字段」变成 prompt 约束，并对结果做字段级校验。

PRD §5.3 要求"待抽取内容 / 目标字段列表 / 字段说明"三者都参与。此前的实现只是
"LLM + json.loads"，`fields_text` 从不被读取——用户在属性面板填了也没有任何作用。
"""

from __future__ import annotations

import json
import re

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.llm import LLMExecutor

# 每行一个字段：`name: 说明` / `name：说明` / `name`，允许前置 - 或 *
_FIELD_LINE = re.compile(r"^\s*[-*]?\s*(?P<name>[^\s:：]+)\s*(?:[:：]\s*(?P<desc>.*))?$")


def parse_fields(fields_text: str) -> list[dict[str, str]]:
    """把多行文本解析成 [{"name": ..., "desc": ...}]，空行与非命中行忽略。"""
    fields: list[dict[str, str]] = []
    for raw_line in (fields_text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = _FIELD_LINE.match(line)
        if not match:
            continue
        fields.append({"name": match.group("name"), "desc": (match.group("desc") or "").strip()})
    return fields


def build_system_prompt(system: str, fields: list[dict[str, str]]) -> str:
    """在原 system 提示后追加输出约束：只输出 JSON，且必须包含这些字段。"""
    parts: list[str] = []
    if system.strip():
        parts.append(system.strip())
    parts.append("只输出一个 JSON 对象，不要输出解释、Markdown 代码块或任何额外文字。")
    parts.append("该 JSON 必须包含以下字段：")
    for field in fields:
        desc = f"（{field['desc']}）" if field["desc"] else ""
        parts.append(f'- "{field["name"]}"{desc}')
    return "\n".join(parts)


class ExtractExecutor(LLMExecutor):
    node_type = "extract"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        fields = parse_fields(config.get("fields_text", ""))

        config["format"] = "json"
        if fields:
            config["system"] = build_system_prompt(config.get("system", ""), fields)

        result = await super()._run(ctx, config)
        if result.status != "success":
            return result

        data = result.output
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception as exc:
                result.status = "failed"
                result.error = f"JSON parse failed: {exc}"
                return result

        if fields:
            if not isinstance(data, dict):
                result.status = "failed"
                result.error = "抽取结果不是 JSON 对象"
                return result

            missing = [field["name"] for field in fields if field["name"] not in data]
            if missing:
                # 保留 model / tokens 便于定位，只把状态改为失败
                result.status = "failed"
                result.error = f"抽取结果缺少字段：{', '.join(missing)}"

        result.output = data
        return result
