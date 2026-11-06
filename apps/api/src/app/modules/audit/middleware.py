"""审计日志中间件（ASYNC-06）。

在租户中间件内层运行：此时 TenantContext 已就绪，响应返回后统一记录写操作。
只记录成功（2xx）的 `POST/PUT/PATCH/DELETE`，并只覆盖显式声明的路由，
避免把校验、试连、SSE 等非变更请求写进审计。

桌面模式（无 TenantContext）同样生效，只是 user/workspace 记为 NULL，
与现有手动日志的桌面行为一致。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.logger import log


@dataclass(frozen=True)
class AuditRule:
    """一条「HTTP 路由 → 审计动作」映射。"""

    method: str
    pattern: re.Pattern[str]
    action: str
    resource_type: str
    # 资源 id 在正则里的命名组；None 表示集合级操作（如创建）
    id_group: str | None = None
    # 审计归属的工作空间命名组；工作空间管理类接口用它覆盖 TenantContext
    workspace_group: str | None = None


def _rule(
    method: str,
    pattern: str,
    action: str,
    resource_type: str,
    *,
    id_group: str | None = "resource_id",
    workspace_group: str | None = None,
) -> AuditRule:
    return AuditRule(
        method=method,
        pattern=re.compile(f"^{pattern}$"),
        action=action,
        resource_type=resource_type,
        id_group=id_group,
        workspace_group=workspace_group,
    )


# 只列真正改变数据的路由：GET / validate / providers/{id}/test / runs/{id}/events 都不记录
_RULES: tuple[AuditRule, ...] = (
    _rule("POST", r"/api/v1/workflows", "workflow.create", "workflow", id_group=None),
    _rule("PUT", r"/api/v1/workflows/(?P<resource_id>[^/]+)", "workflow.update", "workflow"),
    _rule("DELETE", r"/api/v1/workflows/(?P<resource_id>[^/]+)", "workflow.delete", "workflow"),
    _rule(
        "POST",
        r"/api/v1/workflows/(?P<resource_id>[^/]+)/duplicate",
        "workflow.duplicate",
        "workflow",
    ),
    _rule(
        "POST",
        r"/api/v1/workflows/(?P<resource_id>[^/]+)/versions/[^/]+/restore",
        "workflow.restore_version",
        "workflow",
    ),
    _rule(
        "POST",
        r"/api/v1/workflows/(?P<resource_id>[^/]+)/publish",
        "workflow.publish",
        "workflow",
    ),
    _rule(
        "POST",
        r"/api/v1/workflows/(?P<resource_id>[^/]+)/unpublish",
        "workflow.unpublish",
        "workflow",
    ),
    _rule(
        "POST",
        r"/api/v1/workflows/(?P<resource_id>[^/]+)/runs",
        "run.start",
        "run",
        id_group=None,
    ),
    _rule("POST", r"/api/v1/runs/(?P<resource_id>[^/]+)/cancel", "run.cancel", "run"),
    _rule("POST", r"/api/v1/runs/(?P<resource_id>[^/]+)/rerun", "run.rerun", "run"),
    _rule("POST", r"/api/v1/providers", "provider.create", "provider", id_group=None),
    _rule("PUT", r"/api/v1/providers/(?P<resource_id>[^/]+)", "provider.update", "provider"),
    _rule("DELETE", r"/api/v1/providers/(?P<resource_id>[^/]+)", "provider.delete", "provider"),
    _rule(
        "PUT",
        r"/api/v1/gateway/config",
        "gateway.config_update",
        "gateway",
        id_group=None,
    ),
    _rule(
        "POST",
        r"/api/v1/gateway/routes",
        "gateway.route_upsert",
        "gateway",
        id_group=None,
    ),
    _rule(
        "DELETE",
        r"/api/v1/gateway/routes/(?P<resource_id>[^/]+)",
        "gateway.route_delete",
        "gateway",
    ),
    _rule("PUT", r"/api/v1/settings", "settings.update", "settings", id_group=None),
    # 工作空间管理：审计归属取路径里的 workspace，而不是 token 里的当前工作空间
    _rule(
        "PUT",
        r"/api/v1/workspaces/(?P<workspace_id>[^/]+)",
        "workspace.update",
        "workspace",
        id_group="workspace_id",
        workspace_group="workspace_id",
    ),
    _rule(
        "DELETE",
        r"/api/v1/workspaces/(?P<workspace_id>[^/]+)",
        "workspace.delete",
        "workspace",
        id_group="workspace_id",
        workspace_group="workspace_id",
    ),
    _rule(
        "POST",
        r"/api/v1/workspaces/(?P<workspace_id>[^/]+)/members",
        "workspace.member_invite",
        "workspace",
        id_group="workspace_id",
        workspace_group="workspace_id",
    ),
    _rule(
        "PUT",
        r"/api/v1/workspaces/(?P<workspace_id>[^/]+)/members/[^/]+",
        "workspace.member_role_update",
        "workspace",
        id_group="workspace_id",
        workspace_group="workspace_id",
    ),
    _rule(
        "DELETE",
        r"/api/v1/workspaces/(?P<workspace_id>[^/]+)/members/[^/]+",
        "workspace.member_remove",
        "workspace",
        id_group="workspace_id",
        workspace_group="workspace_id",
    ),
    _rule("POST", r"/api/v1/api-keys", "api_key.create", "api_key", id_group=None),
    _rule(
        "DELETE",
        r"/api/v1/api-keys/(?P<resource_id>[^/]+)",
        "api_key.revoke",
        "api_key",
    ),
    # 外部触发：resource_id 是被触发的工作流；workspace/user 由 API Key 依赖注入
    _rule(
        "POST",
        r"/api/v1/triggers/http/(?P<resource_id>[^/]+)",
        "trigger.http",
        "workflow",
    ),
)

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _match(method: str, path: str) -> tuple[AuditRule, re.Match[str]] | None:
    for rule in _RULES:
        if rule.method != method:
            continue
        match = rule.pattern.match(path)
        if match is not None:
            return rule, match
    return None


class AuditMiddleware(BaseHTTPMiddleware):
    """写操作成功后落一条审计日志；失败请求、只读请求直接跳过。"""

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request, call_next):
        response = await call_next(request)

        if request.method not in _MUTATING_METHODS:
            return response
        if not 200 <= response.status_code < 300:
            return response

        matched = _match(request.method, request.url.path)
        if matched is None:
            return response

        rule, match = matched
        self._write(request, rule, match)
        return response

    @staticmethod
    def _write(request, rule: AuditRule, match: re.Match[str]) -> None:
        """审计失败不能影响主请求，因此整体兜底。"""
        from app.db.database import SessionLocal
        from app.modules.audit.service import log_action

        resource_id = match.group(rule.id_group) if rule.id_group else None
        workspace_id = match.group(rule.workspace_group) if rule.workspace_group else None
        forwarded = request.headers.get("x-forwarded-for", "")
        ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else None)

        try:
            with SessionLocal() as session:
                log_action(
                    session,
                    rule.action,
                    resource_type=rule.resource_type,
                    resource_id=resource_id,
                    workspace_id=workspace_id,
                    detail=f"{request.method} {request.url.path}",
                    ip=ip,
                    user_agent=request.headers.get("user-agent"),
                )
                session.commit()
        except Exception:
            log.warning(f"审计日志写入失败: {request.method} {request.url.path}", exc_info=True)
