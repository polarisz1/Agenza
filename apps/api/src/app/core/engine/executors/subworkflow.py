"""TRIGGER-02 Phase A：子工作流执行器（内联执行）。

把同 workspace 的已发布工作流当作节点执行：
- 只读取 `published_version_id` 对应的版本快照，保证结果可复现；
- 在父 Run 内创建嵌套 Scheduler，不新建独立 Run（规避 running 唯一索引）；
- 通过调用栈检测自引用/循环，并限制最大嵌套深度；
- 子节点 Token 汇总到父节点，父取消/超时通过任务取消自然传导。
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace

from app.core.config import settings
from app.core.engine.contexts import NodeContext, NodeResult
from app.core.engine.executors.base import BaseExecutor
from app.core.engine.registry import build_default_registry
from app.core.engine.scheduler import Scheduler
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

        # 嵌套 Scheduler 只接收网关快照：父级已解析好的模型路由与预算状态
        gateway = SimpleNamespace(
            router=ctx.model_router,
            budget_exhausted=ctx.budget_exhausted,
            budget_message=ctx.budget_message,
        )
        node_path = ctx.node_path or str(ctx.node.get("id") or "")
        node_name_path = ctx.node_name_path or str(ctx.node.get("name") or node_path)
        nested = Scheduler(
            run_id=ctx.run_id,
            concurrency=settings.ENGINE_MAX_CONCURRENCY,
            node_id_prefix=f"{node_path}/",
            node_name_prefix=f"{node_name_path} / ",
        )
        results = await nested.run(
            graph=graph,
            inputs=child_inputs,
            registry=build_default_registry().all(),
            providers_registry=ctx.providers,
            gateway=gateway,
            on_node_started=ctx.on_node_started,
            on_node_finished=ctx.on_node_finished,
            workflow_stack=[*stack, workflow_id],
            subworkflow_loader=ctx.subworkflow_loader,
        )

        tokens_in = sum(result.tokens_in for result in results.values())
        tokens_out = sum(result.tokens_out for result in results.values())

        failed = [result for result in results.values() if result.status == "failed"]
        if failed:
            detail = next((result.error for result in failed if result.error), "未知错误")
            return NodeResult(
                status="failed",
                error=f"子工作流「{name}」失败：{detail}",
                tokens_in=tokens_in,
                tokens_out=tokens_out,
            )

        outputs: dict = {}
        for node in nodes:
            if node.get("type") != "output":
                continue
            result = results.get(node.get("id"))
            if (
                result is not None
                and result.status == "success"
                and isinstance(result.output, dict)
            ):
                outputs.update(result.output)

        return NodeResult(
            status="success",
            output=outputs or None,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )


def _fail(message: str) -> NodeResult:
    return NodeResult(status="failed", error=message)
