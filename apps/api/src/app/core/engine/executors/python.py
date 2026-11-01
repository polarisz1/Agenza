"""Python script executor - 在隔离子进程里跑用户脚本。

隔离手段（AGENTS §6）：独立子进程 + `-I -S`（隔离模式、不加载 site-packages）
+ 临时工作目录 + 超时 kill + 最小环境变量白名单。
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from app.core.config import settings
from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor

# 只透传运行必需的系统变量：用户的 API Key 等不再泄露给脚本
_ENV_WHITELIST = (
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
)
_MAX_CAPTURE = 64 * 1024  # stdout/stderr 各最多保留 64KB，避免大输出撑爆内存/库


def _child_env(tmp: Path) -> dict[str, str]:
    env = {key: os.environ[key] for key in _ENV_WHITELIST if key in os.environ}
    env.update(
        {
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
            "TEMP": str(tmp),
            "TMP": str(tmp),
        }
    )
    return env


# 随包内置解释器的候选相对路径（Windows 是 python.exe，类 Unix 在 bin/ 下）
_BUNDLED_CANDIDATES = ("pyemb/python.exe", "pyemb/bin/python3")


def resolve_python_bin(
    *,
    explicit: str = "",
    resource_dir: Path | None = None,
    frozen: bool = False,
) -> tuple[str | None, str | None]:
    """选出跑用户脚本的解释器，返回 `(路径, 错误信息)`。

    优先级（评审 D-5）：
    1. `PYTHON_BIN` 显式指定（运维/调试用）
    2. 资源目录里的随包解释器 `pyemb/python.exe`（打包态的唯一正确来源）
    3. 开发态回退到当前进程的解释器（venv 里的 python）

    打包后 `sys.executable` 就是 `backend.exe` 自己，**绝不能**再拿它当解释器，
    否则等于再起一个后端（M4 前置验证 ① 已实测复现）。
    """
    if explicit.strip():
        candidate = Path(explicit.strip())
        if candidate.is_file():
            return str(candidate), None
        return None, f"PYTHON_BIN 指向的解释器不存在：{explicit}"

    if resource_dir is not None:
        for relative in _BUNDLED_CANDIDATES:
            bundled = resource_dir / relative
            if bundled.is_file():
                return str(bundled), None

    if frozen:
        hint = f"{resource_dir}" if resource_dir is not None else "未提供 --resource-dir"
        return None, (
            "找不到可用的 Python 解释器：打包环境里期望随包内置 "
            f"pyemb/python.exe（资源目录：{hint}）。"
            "请在打包时把 embeddable CPython 放进 resources/pyemb/。"
        )

    return sys.executable, None


class PythonExecutor(BaseExecutor):
    node_type = "python"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        script = config.get("script", "")
        timeout = config.get("timeout_s", 60)
        if not script:
            return NodeResult(status="failed", error="Empty script")

        python_bin, resolve_error = resolve_python_bin(
            explicit=settings.PYTHON_BIN,
            resource_dir=settings.resource_root,
            frozen=settings.is_packaged,
        )
        if python_bin is None:
            return NodeResult(status="failed", error=resolve_error)

        input_data = {"inputs": ctx.run_inputs, "upstream": ctx.upstream}

        tmp = Path(tempfile.mkdtemp(prefix="agentflow_script_"))
        # 显式 utf-8：Windows 的默认编码是 cp936，中文会写坏/读坏
        (tmp / "input.json").write_text(
            json.dumps(input_data, ensure_ascii=False), encoding="utf-8"
        )
        (tmp / "script.py").write_text(script, encoding="utf-8")
        (tmp / "runner.py").write_text(_RUNNER, encoding="utf-8")

        try:
            argv = [python_bin, "-I", "-S", str(tmp / "runner.py")]
            returncode, stdout, stderr = await _communicate(
                argv,
                cwd=str(tmp),
                env=_child_env(tmp),
                timeout=timeout,
            )

            if returncode != 0:
                detail = _decode(stderr)[:500]
                return NodeResult(
                    status="failed",
                    error=f"Script exit {returncode}: {detail}",
                )

            output_path = tmp / "output.json"
            if output_path.exists():
                out = json.loads(output_path.read_text(encoding="utf-8"))
            else:
                out = _decode(stdout)

            return NodeResult(status="success", output=out)
        except TimeoutError:
            return NodeResult(status="failed", error=f"Script timed out after {timeout}s")
        except asyncio.CancelledError:
            # 外层取消（运行被取消 / 调度器超时）时子进程已在 _communicate 里被杀掉
            raise
        finally:
            with contextlib.suppress(Exception):
                shutil.rmtree(str(tmp), ignore_errors=True)


async def _communicate(
    argv: list[str],
    *,
    cwd: str,
    env: dict[str, str],
    timeout: float | None,
) -> tuple[int, bytes, bytes]:
    """跑子进程并返回 (returncode, stdout, stderr)。

    优先用 asyncio 子进程；如果当前事件循环不支持（Windows 的 SelectorEventLoop，
    uvicorn 在 reload / 多 worker 时就会选它），退化为"线程 + subprocess.Popen"。

    为什么必须有降级（v0.1.1 热修 B1）：Selector loop 上的
    `asyncio.create_subprocess_exec` 会抛 `NotImplementedError`（消息为空），
    表现就是"Python 节点必然失败且看不到任何原因"。
    """
    proc = await _spawn_subprocess(argv, cwd=cwd, env=env)
    if proc is None:
        return await _communicate_threaded(argv, cwd=cwd, env=env, timeout=timeout)

    try:
        if timeout is None:
            out, err = await proc.communicate()
        else:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        await _terminate(proc)
        raise
    except asyncio.CancelledError:
        await _terminate(proc)
        raise

    return proc.returncode or 0, out or b"", err or b""


async def _spawn_subprocess(
    argv: list[str],
    *,
    cwd: str,
    env: dict[str, str],
) -> asyncio.subprocess.Process | None:
    """创建 asyncio 子进程；当前 loop 不支持时返回 None（由调用方降级）。"""
    try:
        return await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except NotImplementedError:
        # Windows SelectorEventLoop：没有 subprocess transport
        return None


async def _communicate_threaded(
    argv: list[str],
    *,
    cwd: str,
    env: dict[str, str],
    timeout: float | None,
) -> tuple[int, bytes, bytes]:
    """线程池里跑 Popen 的降级路径（超时/取消都会 kill 掉进程）。"""
    loop = asyncio.get_running_loop()
    state: dict[str, object] = {"proc": None, "aborted": False}

    def worker() -> tuple[int, bytes, bytes]:
        proc = subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        state["proc"] = proc
        if state["aborted"]:
            _kill_subprocess(proc)
        out, err = proc.communicate()
        return proc.returncode or 0, out or b"", err or b""

    future = loop.run_in_executor(None, worker)
    try:
        if timeout is None:
            return await future
        return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
    except TimeoutError:
        _abort_threaded(state)
        raise
    except asyncio.CancelledError:
        _abort_threaded(state)
        raise


def _abort_threaded(state: dict[str, object]) -> None:
    """标记放弃并杀掉可能已经起来的进程（含"还没来的及赋值"的竞态）。"""
    state["aborted"] = True
    proc = state.get("proc")
    if isinstance(proc, subprocess.Popen):
        _kill_subprocess(proc)


def _kill_subprocess(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    with contextlib.suppress(OSError):
        proc.kill()


async def _terminate(proc: asyncio.subprocess.Process) -> None:
    """kill 之后必须 wait()：否则进程变僵尸、管道不释放（Windows 会报 unclosed transport）。"""
    with contextlib.suppress(ProcessLookupError):
        proc.kill()
    with contextlib.suppress(TimeoutError, ProcessLookupError, Exception):
        await asyncio.wait_for(proc.wait(), timeout=5)


def _decode(raw: bytes | None) -> str:
    if not raw:
        return ""
    return raw[:_MAX_CAPTURE].decode("utf-8", errors="replace")


_RUNNER = """
import json, sys
from pathlib import Path

def main():
    namespace = {}
    # utf-8-sig：容忍脚本带 BOM（PowerShell/记事本另存常见），否则 exec 会 SyntaxError
    exec(Path('script.py').read_text(encoding='utf-8-sig'), namespace)
    result = namespace.get('agentflow_result', None)
    if result is None:
        print('Script did not produce result via agentflow_result', file=sys.stderr)
        return 1
    Path('output.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    return 0

sys.exit(main())
"""
