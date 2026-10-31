"""Startup entry point: CLI + env 注入，再交给 uvicorn。

打包后的后端由 Electron 启动，端口、数据目录、资源目录都必须**由外层显式传入**
（不能再用 `__file__` 推算，那在 PyInstaller 的 `_MEIPASS` 下指向临时目录）。

优先级：命令行 > 环境变量 > 默认值。
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from app.core.defaults import DEFAULT_HOST, DEFAULT_LOG_LEVEL, DEFAULT_PORT


@dataclass(frozen=True)
class LaunchPlan:
    """一次启动的最终参数（纯数据，便于测试）。"""

    host: str
    port: int
    data_dir: str | None
    resource_dir: str | None
    mount_frontend: bool
    reload: bool
    log_level: str

    def as_env(self) -> dict[str, str]:
        """需要写回环境的项（供 app.core.config 在导入时读取）。"""
        env = {
            "HOST": self.host,
            "PORT": str(self.port),
            "MOUNT_FRONTEND": "true" if self.mount_frontend else "false",
            "LOG_LEVEL": self.log_level,
        }
        if self.data_dir:
            env["DATA_DIR"] = self.data_dir
        if self.resource_dir:
            env["RESOURCE_DIR"] = self.resource_dir
        return env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agentflow-api", description="AgentFlow 后端服务")
    parser.add_argument("--host", help=f"监听地址（默认 {DEFAULT_HOST}）")
    parser.add_argument("--port", type=int, help=f"监听端口（默认 {DEFAULT_PORT}）")
    parser.add_argument("--data-dir", help="数据目录（库文件与主密钥），打包态必须显式指定")
    parser.add_argument("--resource-dir", help="随包资源目录（含 frontend-dist/ 与 alembic/）")
    parser.add_argument("--log-level", help=f"日志级别（默认 {DEFAULT_LOG_LEVEL}）")
    parser.add_argument(
        "--mount-frontend",
        dest="mount_frontend",
        action="store_true",
        default=None,
        help="由后端托管前端产物（打包态默认开启）",
    )
    parser.add_argument(
        "--no-mount-frontend",
        dest="mount_frontend",
        action="store_false",
        default=None,
        help="不托管前端产物（只提供 API）",
    )
    return parser


def _env_bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return None


def resolve_launch(
    env: Mapping[str, str],
    argv: Sequence[str],
    *,
    frozen: bool = False,
) -> LaunchPlan:
    """把「命令行 + 环境变量 + 默认值」合成最终启动参数。

    冻结（打包）环境下 `reload` 永远关闭：uvicorn 的 reloader 会再拉起一个进程，
    在 exe 里既无意义又会泄漏进程。
    """
    args = build_parser().parse_args(list(argv))

    host = args.host or env.get("HOST") or DEFAULT_HOST
    port = args.port or int(env.get("PORT") or DEFAULT_PORT)
    data_dir = args.data_dir or env.get("DATA_DIR") or None
    resource_dir = args.resource_dir or env.get("RESOURCE_DIR") or None
    log_level = (args.log_level or env.get("LOG_LEVEL") or DEFAULT_LOG_LEVEL).upper()

    mount = args.mount_frontend
    if mount is None:
        mount = _env_bool(env.get("MOUNT_FRONTEND"))
    if mount is None:
        mount = frozen

    debug = _env_bool(env.get("DEBUG"))
    if debug is None:
        debug = True
    reload = debug and not frozen

    return LaunchPlan(
        host=host,
        port=port,
        data_dir=data_dir,
        resource_dir=resource_dir,
        mount_frontend=mount,
        reload=reload,
        log_level=log_level,
    )


def _write_pid_file() -> None:
    """把当前进程 pid 写进数据目录，供桌面壳清理"上次崩溃留下的孤儿后端"。

    为什么不能用壳记录的 pid：单文件 exe 有引导进程 + 真正的服务进程两代，
    引导进程先死时，壳记的 pid 就指错了对象（实测孤儿会一直占着端口和库）。
    """
    try:
        from pathlib import Path

        from app.core.config import settings

        target = Path(settings.DATA_DIR) / "backend.pid"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        pass  # 非致命：拿不到就让壳退回到 runtime.json 的 pid


def main(argv: Sequence[str] | None = None) -> None:
    frozen = is_frozen()
    plan = resolve_launch(os.environ, sys.argv[1:] if argv is None else argv, frozen=frozen)

    # 必须在 import app.main 之前写环境：Settings 是导入时创建的单例
    os.environ.update(plan.as_env())

    if frozen and "DEBUG" not in os.environ:
        # 打包态默认不调试：DEBUG=True 会让 SQLAlchemy 打印每条 SQL，
        # 日志噪音大、也拖慢启动（实测几秒就上百行）
        os.environ["DEBUG"] = "false"

    import uvicorn

    # reload 只认 "module:attr" 字符串；不 reload 时直接传对象，
    # 这样 PyInstaller 能静态发现 app.main（否则冻结后 uvicorn 导入不到它）
    target: str | object
    if plan.reload:
        target = "app.main:app"
    else:
        from app.main import app as application

        target = application

    _write_pid_file()

    uvicorn.run(
        target,
        host=plan.host,
        port=plan.port,
        reload=plan.reload,
        log_level=plan.log_level.lower(),
    )


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


if __name__ == "__main__":
    main()
