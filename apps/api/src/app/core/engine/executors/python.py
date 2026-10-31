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
            proc = await asyncio.create_subprocess_exec(
                python_bin,
                "-I",
                "-S",
                str(tmp / "runner.py"),
                cwd=str(tmp),
                env=_child_env(tmp),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except TimeoutError:
                await _terminate(proc)
                return NodeResult(status="failed", error=f"Script timed out after {timeout}s")
            except asyncio.CancelledError:
                # 外层取消（运行被取消 / 调度器超时）时也必须杀掉子进程，
                # 否则脚本会继续在后台跑，占 CPU 并泄漏管道。
                await _terminate(proc)
                raise

            if proc.returncode != 0:
                detail = _decode(stderr)[:500]
                return NodeResult(
                    status="failed",
                    error=f"Script exit {proc.returncode}: {detail}",
                )

            output_path = tmp / "output.json"
            if output_path.exists():
                out = json.loads(output_path.read_text(encoding="utf-8"))
            else:
                out = _decode(stdout)

            return NodeResult(status="success", output=out)
        finally:
            with contextlib.suppress(Exception):
                shutil.rmtree(str(tmp), ignore_errors=True)


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
