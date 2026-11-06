"""AgentFlow - FastAPI Application Entry Point

SaaS 转型说明：
- tenant_middleware 在 TENANCY_ENABLED=True 时注入租户上下文
- /api/v1/auth 和 /api/v1/workspaces 是 SaaS 新增路由
- 原有路由保留 /api/* 前缀（向后兼容桌面版），未来逐步切到 /api/v1/*
- 单用户桌面模式（TENANCY_ENABLED=False）下 tenant_middleware 为 no-op
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.logger import log
from app.core.tenancy import TenantMiddleware
from app.db.database import init_db
from app.modules.audit.middleware import AuditMiddleware

# 前端产物位置统一由 settings.frontend_dist 决定（开发态回退仓库布局，打包态取注入的资源目录）


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle."""
    mode = "SaaS" if settings.TENANCY_ENABLED else "desktop (single-user)"
    log.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION} [{mode}]")
    init_db()
    log.info("Database initialized")

    yield

    log.info("Shutting down AgentFlow")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "AgentFlow - "
        + (
            "Enterprise AI workflow orchestration"
            if settings.TENANCY_ENABLED
            else "Single-user local AI workflow orchestration"
        )
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)


# ============ Middleware ============
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    # 开发期用正则兜住 localhost/127.0.0.1 的任意端口，避免 Vite 端口递增后跨域被拒；
    # 生产环境该值为空，只认 CORS_ORIGINS 显式白名单。
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AuditMiddleware 必须在 TenantMiddleware 内层（先注册），
# 这样响应返回时 TenantContext 还没被清理，审计能带上 user/workspace。
app.add_middleware(AuditMiddleware)
app.add_middleware(TenantMiddleware)


@app.middleware("http")
async def request_logging(request, call_next):
    """Log every request with duration."""
    import time

    start = time.time()
    try:
        response = await call_next(request)
    except Exception:
        log.exception(f"Unhandled: {request.method} {request.url.path}")
        raise

    duration = round((time.time() - start) * 1000, 1)
    log.info(f"{request.method:6s} {request.url.path:<40s} {response.status_code} {duration:>8}ms")
    response.headers["X-Process-Time"] = f"{duration}ms"
    return response


# ============ Exception Handlers ============
@app.exception_handler(AppError)
async def app_exception_handler(request, exc: AppError):
    """Business exception → unified error response."""
    return JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": exc.data},
    )


from starlette.exceptions import HTTPException as StarletteHTTPException


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc: StarletteHTTPException):
    """框架级错误也走同一个信封。"""
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.status_code, "message": str(exc.detail), "data": None},
    )


@app.exception_handler(Exception)
async def global_exception_handler(request, exc: Exception):
    """Last-resort handler."""
    log.exception(f"Unhandled in {request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"code": 500, "message": f"Internal error: {type(exc).__name__}"},
    )


# ============ Router Registration ============
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import api_key_router
from app.modules.auth.router import router as auth_router
from app.modules.gateway.router import router as gateway_router
from app.modules.providers.router import router as providers_router
from app.modules.runs.router import router as runs_router
from app.modules.settings.router import router as settings_router
from app.modules.triggers.router import router as triggers_router
from app.modules.workflows.router import router as workflows_router
from app.modules.workspaces.router import router as workspaces_router

# SaaS v1 路由（认证 + 工作空间 + 审计 + 核心业务）
app.include_router(auth_router, prefix="/api/v1", tags=["v1-auth"])
app.include_router(api_key_router, prefix="/api/v1", tags=["v1-api-keys"])
app.include_router(workspaces_router, prefix="/api/v1", tags=["v1-workspaces"])
app.include_router(audit_router, prefix="/api/v1", tags=["v1-audit-logs"])
app.include_router(workflows_router, prefix="/api/v1/workflows", tags=["v1-workflows"])
app.include_router(runs_router, prefix="/api/v1/runs", tags=["v1-runs"])
app.include_router(providers_router, prefix="/api/v1/providers", tags=["v1-providers"])
app.include_router(settings_router, prefix="/api/v1/settings", tags=["v1-settings"])
app.include_router(gateway_router, prefix="/api/v1", tags=["v1-gateway"])
app.include_router(triggers_router, prefix="/api/v1", tags=["v1-triggers"])

# 桌面版同样通过 /api/* 访问（gateway 只有 v1 一套路由）
app.include_router(gateway_router, prefix="/api", tags=["gateway"])

# 原有路由（保留桌面 / Electron 兼容；新前端一律走 /api/v1）
app.include_router(workflows_router, prefix="/api/workflows", tags=["workflows"])
app.include_router(runs_router, prefix="/api/runs", tags=["runs"])
app.include_router(providers_router, prefix="/api/providers", tags=["providers"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])


# ============ Root ============
@app.get("/", tags=["root"])
def root():
    dist = settings.frontend_dist
    if settings.MOUNT_FRONTEND and (dist / "index.html").exists():
        from fastapi.responses import FileResponse

        return FileResponse(dist / "index.html")
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "status": "ok",
        "tenancy_enabled": settings.TENANCY_ENABLED,
    }


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


# ============ Dev / Packaged Frontend Mount ============
if settings.MOUNT_FRONTEND:
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles

    frontend_dist = settings.frontend_dist
    if (frontend_dist / "index.html").exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(frontend_dist / "assets")),
            name="assets",
        )

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa_fallback(full_path: str):
            """SPA 回退：非 API 路径返回 index.html，静态文件按白名单根目录校验。"""
            if full_path.startswith(("api/", "docs", "redoc", "openapi.json")):
                return JSONResponse(
                    {"code": 404, "message": "Not Found", "data": None}, status_code=404
                )

            dist_root = frontend_dist.resolve()
            candidate = (frontend_dist / full_path).resolve()
            try:
                candidate.relative_to(dist_root)
            except ValueError:
                return JSONResponse(
                    {"code": 404, "message": "Not Found", "data": None}, status_code=404
                )

            if full_path and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")

        log.info(f"Mounted frontend SPA at / from {frontend_dist}")
