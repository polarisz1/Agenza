"""Python 脚本节点：隔离、编码、超时与错误契约（G10 / AGENTS §6）。

用真实子进程跑，验证：
- 环境变量白名单（用户的 API Key 不会泄露给脚本）
- input.json 以 UTF-8 写入，脚本能按 UTF-8 读回中文
- 超时后进程被 kill 且被回收（不产生僵尸/未关闭管道）
- 脚本未产出结果 / 非零退出时的错误信息
"""

from __future__ import annotations

import time

import pytest

from app.core.engine.contexts import NodeContext
from app.core.engine.executors.python import PythonExecutor


def _ctx(script: str, timeout_s: float | None = None, inputs: dict | None = None) -> NodeContext:
    config: dict = {"script": script}
    if timeout_s is not None:
        config["timeout_s"] = timeout_s
    return NodeContext(
        node={"id": "py", "type": "python", "name": "脚本", "config": config},
        run_inputs=inputs or {},
    )


async def test_environment_is_whitelisted(monkeypatch) -> None:
    monkeypatch.setenv("AGENTFLOW_SECRET_TOKEN", "sk-should-not-leak")

    result = await PythonExecutor().execute(
        _ctx("import os\nagentflow_result = {'env': dict(os.environ)}\n")
    )

    assert result.status == "success"
    env = result.output["env"]
    assert "AGENTFLOW_SECRET_TOKEN" not in env, "用户密钥不能泄露给脚本"
    assert env.get("PYTHONIOENCODING") == "utf-8"


async def test_input_json_is_utf8_readable() -> None:
    script = (
        "import json\n"
        "from pathlib import Path\n"
        "data = json.loads(Path('input.json').read_text(encoding='utf-8'))\n"
        "agentflow_result = {'echo': data['inputs']['text']}\n"
    )

    result = await PythonExecutor().execute(_ctx(script, inputs={"text": "中文内容 🙂"}))

    assert result.status == "success"
    assert result.output["echo"] == "中文内容 🙂"


async def test_output_json_roundtrip() -> None:
    result = await PythonExecutor().execute(_ctx("agentflow_result = {'title': '测试', 'n': 3}\n"))

    assert result.status == "success"
    assert result.output == {"title": "测试", "n": 3}


async def test_timeout_kills_and_reaps_process() -> None:
    started = time.perf_counter()
    result = await PythonExecutor().execute(
        _ctx("import time\ntime.sleep(10)\nagentflow_result = {}\n", timeout_s=0.5)
    )
    elapsed = time.perf_counter() - started

    assert result.status == "failed"
    assert "timed out" in (result.error or "").lower()
    assert elapsed < 5, "超时后应尽快返回，不应等脚本自己结束"


async def test_missing_result_reports_exit_code() -> None:
    result = await PythonExecutor().execute(_ctx("x = 1\n"))

    assert result.status == "failed"
    assert "Script exit 1" in (result.error or "")
    assert "agentflow_result" in (result.error or "")


async def test_empty_script_fails_fast() -> None:
    result = await PythonExecutor().execute(_ctx(""))

    assert result.status == "failed"
    assert result.error == "Empty script"


async def test_cancellation_propagates() -> None:
    """外层取消（运行被取消 / 调度器超时）时异常原样抛出，子进程被回收。"""
    import asyncio

    task = asyncio.create_task(
        PythonExecutor().execute(_ctx("import time\ntime.sleep(30)\nagentflow_result = {}\n"))
    )
    await asyncio.sleep(0.3)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
