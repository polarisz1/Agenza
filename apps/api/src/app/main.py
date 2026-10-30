"""AgentFlow - FastAPI Application Entry Point"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.exceptions import AppException
from app.core.logger import log
from app.db.database import Base, engine, init_db

# main.py → app → src → api → apps，前端产物在 apps/web/dist
FRONTEND_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle."""
    log.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    init_db()
    log.info("Database initialized")

    # Start background engines here when ready
    yield

    log.info("Shutting down AgentFlow")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AgentFlow - Single-user local AI workflow orchestration",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)


# ============ Middleware ============
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    log.info(
        f"{request.method:6s} {request.url.path:<40s} "
        f"{response.status_code} {duration:>8}ms"
    )
    response.headers["X-Process-Time"] = f"{duration}ms"
    return response


# ============ Exception Handlers ============
@app.exception_handler(AppException)
async def app_exception_handler(request, exc: AppException):
    """Business exception → unified error response."""
    return JSONResponse(
        status_code=exc.code,
        content={"code": exc.code, "message": exc.message, "data": exc.data},
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
from app.modules.workflows.router import router as workflows_router
from app.modules.runs.router import router as runs_router
from app.modules.providers.router import router as providers_router
from app.modules.settings.router import router as settings_router

app.include_router(workflows_router, prefix="/api/workflows", tags=["workflows"])
app.include_router(runs_router, prefix="/api/runs", tags=["runs"])
app.include_router(providers_router, prefix="/api/providers", tags=["providers"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])


# ============ Root ============
@app.get("/", tags=["root"])
def root():
    if settings.MOUNT_FRONTEND and (FRONTEND_DIST / "index.html").exists():
        from fastapi.responses import FileResponse

        return FileResponse(FRONTEND_DIST / "index.html")
    return {
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "status": "ok",
    }


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


# ============ Dev / Packaged Frontend Mount ============
if settings.MOUNT_FRONTEND:
    from fastapi.responses import FileResponse, JSONResponse
    from fastapi.staticfiles import StaticFiles

    # main.py → app → src → api → apps，前端产物在 apps/web/dist
    frontend_dist = FRONTEND_DIST
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
