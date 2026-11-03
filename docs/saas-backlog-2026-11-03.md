# AgentFlow SaaS 转型 · 执行 Backlog

> **来源**: `docs/saas-strategy-2026-11-03.md` 战略评估
> **版本**: v1.0 · 2026-11-03
> **状态**: Sprint 1 进行中

---

## Sprint 概览

| Sprint | 时间 | 主题 | 交付物 |
|--------|------|------|--------|
| **Sprint 1** | W1-W2 | 地基搭建 | PostgreSQL + 多租户 schema + auth + workspace + RBAC |
| **Sprint 2** | W3-W4 | 前端重构 + 异步化 | 路由重构 + 协作状态条 + Celery 队列 + SSE 多租户 |
| **Sprint 3** | W5-W6 | 差异化功能 | AI Gateway + 诊断控制台 + HTTP/Webhook 触发 |
| **Sprint 4** | W7-W8 | 商业化 | 计量 + Stripe 计费 + 审计日志 + 模板市场 |
| **Sprint 5** | W9-W10 | 打磨 + 部署 | UI 打磨 + Docker + 私有化工具包 + 文档 |

---

## Sprint 1 · 地基搭建（W1-W2）

### 1.1 数据库迁移 SQLite → PostgreSQL

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| DB-01 | 在 `pyproject.toml` 添加 `psycopg[binary]` 和 `asyncpg` 依赖 | `apps/api/pyproject.toml` | — | P0 |
| DB-02 | 创建 `apps/api/src/app/core/database.py` 统一数据库入口，支持 SQLite/PostgreSQL 切换（通过环境变量 `DATABASE_URL`） | `apps/api/src/app/core/database.py` | DB-01 | P0 |
| DB-03 | 配置 Alembic 迁移（`alembic.ini` + `env.py`），支持 PostgreSQL 特性（UUID、JSONB、CREATE INDEX CONCURRENTLY） | `apps/api/alembic/` | DB-02 | P0 |
| DB-04 | 所有现有 models.py 增加 `workspace_id: UUID` 外键字段 + 创建混合索引 `(workspace_id, ...)` | `apps/api/src/app/modules/*/models.py` | DB-03 | P0 |
| DB-05 | 全局审计字段统一化（`created_by`, `updated_by`, `deleted_at`） | 所有 models.py | DB-04 | P1 |

### 1.2 多租户中间件与基础设施

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| INFRA-01 | 创建 `TenantContext`（ContextVar）用于在线程/协程间传递当前租户上下文 | `apps/api/src/app/core/tenancy.py` | — | P0 |
| INFRA-02 | 创建 `TenantMiddleware`（FastAPI BaseHTTPMiddleware），从 JWT 或 Header 提取 workspace_id 注入 TenantContext | `apps/api/src/app/core/tenancy.py` | INFRA-01 | P0 |
| INFRA-03 | 创建 `SessionLocal` 的 tenant-aware session（查询时自动注入 `workspace_id` 过滤） | `apps/api/src/app/core/tenancy.py` | DB-02, INFRA-01 | P0 |
| INFRA-04 | 在 `main.py` 注册 TenantMiddleware + 全局异常处理 + CORS 配置 | `apps/api/src/app/main.py` | INFRA-02 | P0 |

### 1.3 Auth 模块（新增）

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| AUTH-01 | 创建 `modules/auth/` 目录，含标准五件套 | `apps/api/src/app/modules/auth/` | — | P0 |
| AUTH-02 | 定义 User / Workspace / WorkspaceMember / ApiKey 模型 | `modules/auth/models.py` | DB-04 | P0 |
| AUTH-03 | 定义 Auth schema（Register/Login/Token/UserProfile/ApiKey） | `modules/auth/schemas.py` | AUTH-02 | P0 |
| AUTH-04 | 实现密码哈希（passlib + bcrypt）+ JWT（python-jose）+ 刷新 Token | `modules/auth/service.py` | AUTH-03 | P0 |
| AUTH-05 | 实现 Repository：用户 CRUD、workspace 成员 CRUD、API Key CRUD | `modules/auth/repository.py` | AUTH-02 | P0 |
| AUTH-06 | 实现 Router：`/api/v1/auth/register` `/api/v1/auth/login` `/api/v1/auth/refresh` `/api/v1/auth/api-keys` | `modules/auth/router.py` | AUTH-04, AUTH-05 | P0 |
| AUTH-07 | 创建依赖函数 `get_current_user` + `require_role(Role)` + `require_workspace_access` | `modules/auth/dependencies.py` | AUTH-06 | P0 |
| AUTH-08 | 添加 passlib[bcrypt] + python-jose[cryptography] + python-multipart 依赖 | `apps/api/pyproject.toml` | — | P0 |

### 1.4 Workspace 模块（新增）

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| WS-01 | 创建 `modules/workspaces/` 目录 + 五件套 | `apps/api/src/app/modules/workspaces/` | — | P0 |
| WS-02 | 定义 Role 枚举（Owner/Editor/Viewer/Operator） + WorkspaceMember 关系扩展 | `modules/workspaces/schemas.py` | AUTH-02 | P0 |
| WS-03 | 实现 Service：创建工作空间（自动把创建者设为 Owner）、成员邀请/移除、角色变更 | `modules/workspaces/service.py` | AUTH-04 | P0 |
| WS-04 | 实现 Router：`/api/v1/workspaces`（CRUD + 成员管理） | `modules/workspaces/router.py` | WS-03 | P0 |

### 1.5 现有模块适配（workspace_id + tenant 隔离）

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| ADAPT-01 | workflows 模块：所有 Repository 查询注入 `workspace_id` 过滤；Service 层增加工作空间上下文校验 | `modules/workflows/repository.py`, `service.py` | INFRA-03 | P0 |
| ADAPT-02 | runs 模块：同上 + Run 模型增加 `triggered_by`（FK → User） | `modules/runs/` | INFRA-03 | P0 |
| ADAPT-03 | providers 模块：模型密钥归属 workspace（之前是全局 settings 下） | `modules/providers/` | DB-04 | P0 |
| ADAPT-04 | settings 模块：拆分为全局系统设置 + 工作空间级别设置 | `modules/settings/` | DB-04 | P1 |
| ADAPT-05 | main.py 注册 auth + workspaces 两个新 router；更新 OpenAPI prefix 为 `/api/v1` | `main.py` | AUTH-06, WS-04 | P0 |

### 1.6 前端地基

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| FE-01 | 创建 `src/features/auth/` 功能模块（api + hooks + components + index.tsx） | `apps/web/src/features/auth/` | Backend AUTH | P0 |
| FE-02 | 登录/注册页面（含表单校验、Loading、错误提示） | `features/auth/components/` | FE-01 | P0 |
| FE-03 | Zustand `useAuthStore`（token 持久化、用户信息、登出） | `features/auth/hooks/useAuthStore.ts` | FE-01 | P0 |
| FE-04 | axios/http.ts 拦截器：自动注入 `Authorization: Bearer` + 401 自动刷新 Token | `shared/utils/http.ts` | FE-03 | P0 |
| FE-05 | 创建 `src/features/workspaces/` 功能模块（工作空间列表、切换、Dashboard 入口） | `features/workspaces/` | Backend WS | P0 |
| FE-06 | 路由守卫：未登录 → 登录页；已登录 → 工作空间列表；有 workspace → 内部路由 | `shared/components/AuthGuard.tsx` | FE-03, FE-05 | P0 |
| FE-07 | AppLayout 顶栏增加：工作空间选择器、订阅状态、用户菜单 | `shared/components/AppLayout.tsx` | FE-05 | P0 |

### 1.7 契约层更新

| ID | 任务 | 文件 | 依赖 | 优先级 |
|----|------|------|------|--------|
| CONTRACTS-01 | 后端新增 schemas（auth + workspaces），运行 `pnpm contracts:generate` 更新 openapi.yaml | `packages/contracts/openapi.yaml` | 所有 backend 改动 | P1 |
| CONTRACTS-02 | 运行 `pnpm contracts:build` 重新生成 TS 类型 | `packages/contracts/src/generated/index.ts` | CONTRACTS-01 | P1 |

---

## Sprint 2 · 前端重构 + 异步化（W3-W4）

| ID | 任务 | 依赖 | 优先级 |
|----|------|------|--------|
| ASYNC-01 | 引入 Redis + Celery（或 ARQ）异步任务队列 | Sprint 1 DB | P0 |
| ASYNC-02 | RunManager 适配异步 worker（从同步调用改为发布任务到队列） | ASYNC-01 | P0 |
| ASYNC-03 | EventBus → Redis Pub/Sub（支持多实例 SSE 广播） | ASYNC-01 | P0 |
| ASYNC-04 | 前端运行编辑器：协作状态条（锁定状态、在线成员、变更闪烁） | FE 地基 | P1 |
| ASYNC-05 | 前端工作流列表：版本 Review 视图（Draft → Ready → Published） | Sprint 1 ADAPT | P1 |
| ASYNC-06 | 审计日志模块（`modules/audit/`）：中间件自动记录 + 查询 API | Sprint 1 | P1 |
| FE-10 | 导航结构重设计：顶栏（workspace switcher）+ 侧栏（按 SaaS 信息架构） | FE 地基 | P0 |
| FE-11 | Dashboard 概览页（今日焦点 + 运行趋势 + 热门工作流 + 成本分布） | Sprint 1 | P1 |

---

## Sprint 3 · 差异化功能（W5-W6）

| ID | 任务 | 依赖 | 优先级 |
|----|------|------|--------|
| GATE-01 | AI Gateway：ModelRouter + 路由策略 + 预算追踪 | providers 适配 | P0 |
| GATE-02 | AI Gateway UI：模型路由策略配置 + 预算告警 + 性能仪表板 | GATE-01 | P0 |
| GATE-03 | 运行详情重构：概览/节点执行/成本分析/调试诊断 四 Tab | runs 模块 | P0 |
| GATE-04 | 诊断 Tab：失败自动分类 + 根因分析 + 修复建议 | GATE-03 | P1 |
| TRIGGER-01 | HTTP / Webhook 触发 API（`POST /api/v1/runs/execute` + Webhook 回调配置） | Sprint 2 ASYNC | P1 |
| TRIGGER-02 | 子工作流 / 模块化复用（工作流节点类型：SubWorkflow） | 引擎改造 | P1 |

---

## Sprint 4 · 商业化（W7-W8）

| ID | 任务 | 依赖 | 优先级 |
|----|------|------|--------|
| BILL-01 | 计量中间件：运行次数、Token 消耗、存储用量的实时采集 | runs + providers | P0 |
| BILL-02 | Stripe 集成：Subscription + Usage Metering + Webhook 处理 | BILL-01 | P0 |
| BILL-03 | 订阅管理 UI：当前计划、用量明细、升级/降级、发票 | BILL-02 | P0 |
| TPL-01 | 模板市场：30+ 高质量工作流模板 + 模板导入/导出 | workflows 模块 | P1 |
| TPL-02 | Prompt Library：团队 prompt 模板库 + 最近效果统计 | LLM 节点 | P1 |

---

## Sprint 5 · 打磨 + 部署（W9-W10）

| ID | 任务 | 依赖 | 优先级 |
|----|------|------|--------|
| DEPLOY-01 | Dockerfile（api + web + nginx + postgres + redis + celery worker） | 全部 | P0 |
| DEPLOY-02 | docker-compose.yml 一键启动 | DEPLOY-01 | P0 |
| DEPLOY-03 | 私有化部署脚本 + 数据迁移指南 | DEPLOY-01 | P1 |
| POLISH-01 | AI Prompt Studio（编辑器 prompt 面板增强：变量预览、Token 估算、JSON Schema 校验） | 编辑器 | P1 |
| POLISH-02 | 暗色主题 | UI 系统 | P2 |
| DOC-01 | API 文档（OpenAPI + 私有化部署文档 + 用户手册） | 全部 | P1 |

---

## 依赖关系图（关键路径）

```
DB-01 ─→ DB-02 ─→ DB-03 ─→ DB-04
                            │
INFRA-01 ─→ INFRA-02 ─→ INFRA-03 ─→ ADAPT-01/02/03/04
                                                  │
AUTH-01~08 ────────────────────────────────────── AUTH-07
WS-01~04 ────────────────────────────────────── WS-04
                                                  │
                                                  ▼
                                            Sprint 2 全部
                                                  │
                                                  ▼
                                            Sprint 3 全部
                                                  │
                                                  ▼
                                            Sprint 4 全部
                                                  │
                                                  ▼
                                            Sprint 5 全部
```

**关键路径**: DB → INFRA → AUTH → WS → ADAPT → FE 地基 → Sprint 2 → Sprint 3 → Sprint 4 → Sprint 5
