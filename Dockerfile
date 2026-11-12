# syntax=docker/dockerfile:1

# ---------- 前端构建 ----------
FROM node:20-alpine AS web

WORKDIR /repo
RUN corepack enable

# 先复制 workspace 清单，利用 Docker 层缓存安装依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @agentflow/web build


# ---------- 后端运行时 ----------
FROM python:3.12-slim AS api

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.11.20 /uv /uvx /bin/

WORKDIR /app

# 先装第三方依赖（利用缓存），再装项目本身
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/api/src ./src
COPY apps/api/alembic ./alembic
COPY apps/api/alembic.ini ./alembic.ini
RUN uv sync --frozen --no-dev

# 前端产物由 FastAPI 直接托管，单容器即可部署
COPY --from=web /repo/apps/web/dist ./frontend-dist

RUN useradd --create-home --uid 10001 agentflow \
    && mkdir -p /data \
    && chown -R agentflow:agentflow /data /app

ENV PATH="/app/.venv/bin:$PATH" \
    DATA_DIR=/data \
    RESOURCE_DIR=/app \
    MOUNT_FRONTEND=true \
    DEBUG=false \
    HOST=0.0.0.0 \
    PORT=8000

USER agentflow
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).read()"

CMD ["python", "-m", "app.run", "--host", "0.0.0.0", "--port", "8000", "--data-dir", "/data", "--resource-dir", "/app", "--mount-frontend"]
