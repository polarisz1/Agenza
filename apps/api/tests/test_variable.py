"""变量解析单测：{{ source.field }} 语法、嵌套路径、数组下标、错误语义。"""

from __future__ import annotations

import pytest

from app.core.engine.variable import VariableError, resolve

SCOPE = {
    "inputs": {"topic": "AI"},
    "llm1": {"text": "hello", "list": [{"k": 1}, {"k": 2}]},
    "情感分类": {"label": "positive"},
}


def test_resolve_nested_field() -> None:
    assert resolve("{{ llm1.text }}", SCOPE) == "hello"


def test_resolve_chinese_node_name() -> None:
    assert resolve("{{ 情感分类.label }}", SCOPE) == "positive"


def test_resolve_inputs() -> None:
    assert resolve("{{ inputs.topic }}", SCOPE) == "AI"


def test_resolve_list_index_after_field() -> None:
    assert resolve("{{ llm1.list[1].k }}", SCOPE) == "2"


def test_resolve_keeps_surrounding_text() -> None:
    assert resolve("主题：{{ inputs.topic }}!", SCOPE) == "主题：AI!"


def test_resolve_multiple_references() -> None:
    assert resolve("{{ llm1.text }}-{{ inputs.topic }}", SCOPE) == "hello-AI"


def test_missing_field_raises() -> None:
    with pytest.raises(VariableError):
        resolve("{{ llm1.nope }}", SCOPE)


def test_unknown_source_raises() -> None:
    with pytest.raises(VariableError):
        resolve("{{ ghost.field }}", SCOPE)


def test_out_of_range_index_raises() -> None:
    with pytest.raises(VariableError):
        resolve("{{ llm1.list[9].k }}", SCOPE)


def test_plain_text_untouched() -> None:
    assert resolve("no variables here", SCOPE) == "no variables here"


def test_resolve_root_level_array_index() -> None:
    """S14 回归：根级下标 {{ arr[0] }} 也要能解析（PRD §5.4）。"""
    assert resolve("{{ arr[0] }}", {"arr": [10, 20]}) == "10"
    assert resolve("{{ arr[1] }}", {"arr": [10, 20]}) == "20"


def test_resolve_index_then_field() -> None:
    assert resolve("{{ arr[0].c }}", {"arr": [{"c": 5}]}) == "5"
