"""B1 回归：事件循环不支持 asyncio 子进程时，Python 节点必须仍可执行。

复现的是 uvicorn 在 Windows + reload 下的真实环境：`SelectorEventLoop` 上的
`asyncio.create_subprocess_exec` 抛空消息的 `NotImplementedError`。
这里直接把"创建子进程"这一步替换成返回 None，强制走线程降级路径。
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.core.engine.contexts import NodeContext
from app.core.engine.executors import python as python_executor
from app.core.engine.executors.python import PythonExecutor


def _ctx(script: str, timeout_s: float = 10) -> NodeContext:
    return NodeContext(
        node={
            "id": "py",
            "type": "python",
            "name": "脚本1",
            "config": {"script": script, "timeout_s": timeout_s},
        },
        run_inputs={"text": "hi"},
        upstream={},
        available={},
        node_names={},
    )


def _disable_asyncio_subprocess(monkeypatch) -> None:
    async def no_subprocess(argv, *, cwd, env):
        return None

    monkeypatch.setattr(python_executor, "_spawn_subprocess", no_subprocess)


def test_threaded_fallback_runs_script(monkeypatch) -> None:
    _disable_asyncio_subprocess(monkeypatch)

    result = asyncio.run(
        PythonExecutor().execute(_ctx("agentflow_result = {'ok': True, 'value': 7}"))
    )

    assert result.status == "success", result.error
    assert result.output == {"ok": True, "value": 7}


def test_threaded_fallback_propagates_script_failure(monkeypatch) -> None:
    _disable_asyncio_subprocess(monkeypatch)

    result = asyncio.run(PythonExecutor().execute(_ctx("raise SystemExit(3)")))

    assert result.status == "failed"
    assert "Script exit 3" in (result.error or "")


def test_threaded_fallback_timeout_kills_process(monkeypatch) -> None:
    _disable_asyncio_subprocess(monkeypatch)

    started = time.perf_counter()
    result = asyncio.run(PythonExecutor().execute(_ctx("import time\ntime.sleep(30)", 0.5)))
    elapsed = time.perf_counter() - started

    assert result.status == "failed"
    assert "timed out" in (result.error or "").lower()
    assert elapsed < 5, f"超时后应立即返回，实际 {elapsed:.1f}s"


def test_threaded_fallback_cancel_kills_process(monkeypatch) -> None:
    _disable_asyncio_subprocess(monkeypatch)

    async def scenario() -> None:
        task = asyncio.create_task(
            PythonExecutor().execute(_ctx("import time\ntime.sleep(30)", 30))
        )
        await asyncio.sleep(0.4)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    started = time.perf_counter()
    asyncio.run(scenario())
    assert time.perf_counter() - started < 5
