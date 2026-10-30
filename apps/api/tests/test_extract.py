"""结构化抽取单测：目标字段进入 prompt，结果做字段级校验。

用假的 provider 适配层断言两件事——发给模型的 system 里确实带了字段约束，
以及返回缺字段时节点失败并明确指出缺了哪些字段。
"""

from __future__ import annotations

import json

from app.core.engine.contexts import NodeContext
from app.core.engine.executors.extract import ExtractExecutor, build_system_prompt, parse_fields
from app.core.providers.base import ChatResult


class FakeAdapter:
    def __init__(self, content: str | dict) -> None:
        self.content = content
        self.calls: list[dict] = []

    async def chat(self, **kwargs) -> ChatResult:
        self.calls.append(kwargs)
        return ChatResult(content=self.content, model="fake-model", tokens_in=11, tokens_out=7)


class FakeRegistry:
    def __init__(self, adapter: FakeAdapter) -> None:
        self.adapter = adapter

    def get(self, _provider_id: str) -> FakeAdapter:
        return self.adapter


def _ctx(config: dict, adapter: FakeAdapter) -> NodeContext:
    return NodeContext(
        node={"id": "e1", "type": "extract", "name": "抽取", "config": config},
        run_inputs={},
        providers=FakeRegistry(adapter),
    )


# 这里不写 {{ }} 模板：变量解析是另一组用例的事，本文件只关心抽取逻辑
BASE_CONFIG = {"provider_id": "pv_1", "prompt": "分析这段文本", "fields_text": ""}


def test_parse_fields_supports_colon_variants() -> None:
    text = "sentiment: 情感倾向\nkeywords：关键词\n\n- summary\n  * score : 1-5 分"

    fields = parse_fields(text)

    assert [f["name"] for f in fields] == ["sentiment", "keywords", "summary", "score"]
    assert fields[0]["desc"] == "情感倾向"
    assert fields[2]["desc"] == ""


def test_build_system_prompt_lists_every_field() -> None:
    prompt = build_system_prompt("你是分析师", parse_fields("sentiment: 情感倾向\nkeywords"))

    assert "你是分析师" in prompt
    assert '"sentiment"（情感倾向）' in prompt
    assert '"keywords"' in prompt
    assert "只输出一个 JSON 对象" in prompt


async def test_all_fields_present_succeeds_and_prompt_carries_schema() -> None:
    adapter = FakeAdapter(json.dumps({"sentiment": "正面", "keywords": ["a"]}))
    config = {**BASE_CONFIG, "fields_text": "sentiment: 情感倾向\nkeywords: 关键词"}

    result = await ExtractExecutor().execute(_ctx(config, adapter))

    assert result.status == "success"
    assert result.output == {"sentiment": "正面", "keywords": ["a"]}
    assert result.model == "fake-model"

    sent_system = adapter.calls[0]["system"]
    assert "情感倾向" in sent_system and "关键词" in sent_system
    assert adapter.calls[0]["response_format"] == "json"


async def test_missing_field_fails_with_field_names() -> None:
    adapter = FakeAdapter(json.dumps({"sentiment": "正面"}))
    config = {**BASE_CONFIG, "fields_text": "sentiment\nkeywords\nsummary"}

    result = await ExtractExecutor().execute(_ctx(config, adapter))

    assert result.status == "failed"
    assert "缺少字段" in (result.error or "")
    assert "keywords" in (result.error or "")
    assert "summary" in (result.error or "")
    # 失败时仍保留用量信息，便于排查
    assert result.tokens_in == 11


async def test_non_json_reply_fails_with_parse_error() -> None:
    adapter = FakeAdapter("抱歉，我无法完成")
    config = {**BASE_CONFIG, "fields_text": "sentiment"}

    result = await ExtractExecutor().execute(_ctx(config, adapter))

    assert result.status == "failed"
    assert "JSON parse failed" in (result.error or "")


async def test_json_array_fails_when_fields_declared() -> None:
    adapter = FakeAdapter(json.dumps([{"sentiment": "正面"}]))
    config = {**BASE_CONFIG, "fields_text": "sentiment"}

    result = await ExtractExecutor().execute(_ctx(config, adapter))

    assert result.status == "failed"
    assert "不是 JSON 对象" in (result.error or "")


async def test_without_fields_text_behaviour_is_unchanged() -> None:
    """没填目标字段时保持旧行为：JSON 能解析就算成功，不做字段校验。"""
    adapter = FakeAdapter(json.dumps({"anything": 1}))

    result = await ExtractExecutor().execute(_ctx(dict(BASE_CONFIG), adapter))

    assert result.status == "success"
    assert result.output == {"anything": 1}
    assert "只输出一个 JSON 对象" not in adapter.calls[0]["system"]
