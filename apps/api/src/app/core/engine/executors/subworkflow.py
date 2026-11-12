"""TRIGGER-02 子工作流执行器（Phase C：独立子运行）。

把同 workspace 的已发布工作流当作节点执行：
- 只读取 `published_version_id` 对应的版本快照，保证结果可复现；
- 通过注入的 runner 创建独立子运行，子运行拥有自己的节点记录 / 诊断 / 趋势；
- 通过调用栈检测自引用/循环，并限制最大嵌套深度；
- 子运行 Token 汇总到父节点，父取消/超时通过任务取消自然传导。
"""

from __future__ import annotations

import inspect

from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor
from app.core.engine.validators import validate_graph
from app.core.exceptions import AppError

# 调用链总长度上限（包含最外层工作流），超过即拒绝执行
MAX_SUBWORKFLOW_DEPTH = 5


class SubWorkflowExecutor(BaseExecutor):
    node_type = "subworkflow"

    async def _run(self, ctx: NodeContext, config: dict) -> NodeResult:
        workflow_id = str(config.get("workflow_id") or "").strip()
        if not workflow_id:
            return _fail("未选择子工作流：请在属性面板选择已发布的工作流")

        stack = list(ctx.workflow_stack or [])
        if workflow_id in stack:
            chain = " → ".join([*stack, workflow_id])
            return _fail(f"检测到子工作流循环引用：{chain}")
        if len(stack) >= MAX_SUBWORKFLOW_DEPTH:
            return _fail(f"子工作流嵌套超过最大深度 {MAX_SUBWORKFLOW_DEPTH} 层")

        if ctx.subworkflow_loader is None:
            return _fail("子工作流加载器未配置，无法执行")

        try:
            snapshot = ctx.subworkflow_loader(workflow_id)
            if inspect.isawaitable(snapshot):
                snapshot = await snapshot
        except AppError as exc:
            return _fail(exc.message)
        except Exception as exc:  # 统一转成节点失败，避免打断父运行
            return _fail(f"加载子工作流失败：{exc}")

        snapshot = snapshot or {}
        graph = snapshot.get("graph") or {}
        name = snapshot.get("name") or workflow_id
        nodes = graph.get("nodes") or []
        if not nodes:
            return _fail(f"子工作流「{name}」没有可执行的节点")

        check = validate_graph(nodes=nodes, edges=graph.get("edges") or [])
        if check["blocking"]:
            detail = "；".join(i["message"] for i in check["issues"] if i["blocking"])
            return _fail(f"子工作流「{name}」配置无效：{detail}")

        mapping = config.get("input_mapping") or {}
        if not isinstance(mapping, dict):
            return _fail("输入映射必须是 { 子工作流输入: 值 } 对象")
        child_inputs = {
            str(key): value for key, value in mapping.items() if value not in (None, "")
        }
        missing = [
            str(field.get("key"))
            for field in graph.get("inputs", [])
            if field.get("required") and str(field.get("key")) not in child_inputs
        ]
        if missing:
            return _fail(f"子工作流「{name}」缺少必填输入：{'、'.join(missing)}")

        if ctx.subworkflow_runner is None:
            return _fail("子工作流运行器未配置，无法执行")

        node_path = ctx.node_path or str(ctx.node.get("id") or "")
        try:
            outcome = ctx.subworkflow_runner(workflow_id, child_inputs, node_path)
            if inspect.isawaitable(outcome):
                outcome = await outcome
        except AppError as exc:
            return _fail(exc.message)
        except Exception as exc:
            return _fail(f"执行子工作流失败：{exc}")

        outcome = outcome or {}
        child_run_id = outcome.get("run_id")
        tokens_in = int(outcome.get("tokens_in") or 0)
        tokens_out = int(outcome.get("tokens_out") or 0)

        if outcome.get("status") != "success":
            detail = outcome.get("error") or "未知错误"
            suffix = f"（子运行 {child_run_id}）" if child_run_id else ""
            return NodeResult(
                status="failed",
                error=f"子工作流「{name}」失败：{detail}{suffix}",
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            )

        return NodeResult(
            status="success",
            output=outcome.get("output"),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )


def _fail(message: str) -> NodeResult:
    return NodeResult(status="failed", error=message)
