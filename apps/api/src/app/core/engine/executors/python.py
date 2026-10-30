"""Python script executor - runs in isolated subprocess."""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor


class PythonExecutor(BaseExecutor):
    node_type = "python"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        script = config.get("script", "")
        timeout = config.get("timeout_s", 60)
        if not script:
            return NodeResult(status="failed", error="Empty script")

        # Build input data (upstream + run_inputs)
        input_data = {
            "inputs": ctx.run_inputs,
            "upstream": ctx.upstream,
        }

        # Write input JSON + script + runner into temp dir
        tmp = Path(tempfile.mkdtemp(prefix="agentflow_script_"))
        (tmp / "input.json").write_text(json.dumps(input_data, ensure_ascii=False))
        (tmp / "script.py").write_text(script, encoding="utf-8")

        runner = f"""
import json, sys
from pathlib import Path

def main():
    data = json.loads(Path('input.json').read_text())
    # User script should call: agentflow.submit(result_dict)
    namespace = {{}}
    exec(Path('script.py').read_text(encoding='utf-8'), namespace)
    # convention: agentflow_result variable or agentflow.submit()
    result = namespace.get('agentflow_result', None)
    if result is None:
        print('Script did not produce result via agentflow_result', file=sys.stderr)
        return 1
    Path('output.json').write_text(json.dumps(result, ensure_ascii=False))
    return 0

sys.exit(main())
"""
        (tmp / "runner.py").write_text(runner, encoding="utf-8")

        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-I", "-S", str(tmp / "runner.py"),
                cwd=str(tmp),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(), timeout=timeout
                )
            except asyncio.TimeoutError:
                proc.kill()
                return NodeResult(status="failed", error=f"Script timed out after {timeout}s")

            if proc.returncode != 0:
                return NodeResult(
                    status="failed",
                    error=f"Script exit {proc.returncode}: {stderr.decode()[:500]}",
                )

            output_path = tmp / "output.json"
            if output_path.exists():
                out = json.loads(output_path.read_text())
            else:
                out = stdout.decode()

            return NodeResult(status="success", output=out)
        finally:
            # best-effort cleanup
            import shutil
            try:
                shutil.rmtree(str(tmp), ignore_errors=True)
            except Exception:
                pass
