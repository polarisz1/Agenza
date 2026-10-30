"""Node executor registry."""
from __future__ import annotations

from collections.abc import Callable

from app.core.engine.contexts import NodeExecutor


class ExecutorRegistry:
    """Maps node_type → executor instance."""

    def __init__(self) -> None:
        self._executors: dict[str, NodeExecutor] = {}

    def register(self, node_type: str, executor: NodeExecutor) -> None:
        self._executors[node_type] = executor

    def get(self, node_type: str) -> NodeExecutor | None:
        return self._executors.get(node_type)

    def all(self) -> dict[str, NodeExecutor]:
        return dict(self._executors)


def build_default_registry() -> ExecutorRegistry:
    """Register all built-in executors."""
    from app.core.engine.executors.input import InputExecutor
    from app.core.engine.executors.llm import LLMExecutor
    from app.core.engine.executors.extract import ExtractExecutor
    from app.core.engine.executors.http import HttpExecutor
    from app.core.engine.executors.python import PythonExecutor
    from app.core.engine.executors.condition import ConditionExecutor
    from app.core.engine.executors.merge import MergeExecutor
    from app.core.engine.executors.output import OutputExecutor

    reg = ExecutorRegistry()
    reg.register("input", InputExecutor())
    reg.register("llm", LLMExecutor())
    reg.register("extract", ExtractExecutor())
    reg.register("http", HttpExecutor())
    reg.register("python", PythonExecutor())
    reg.register("condition", ConditionExecutor())
    reg.register("merge", MergeExecutor())
    reg.register("output", OutputExecutor())
    return reg
