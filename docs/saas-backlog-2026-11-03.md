# AgentFlow SaaS 转型 · 执行 Backlog

> **来源**: `docs/saas-strategy-2026-11-03.md` 战略评估
> **版本**: v1.1 · 2026-11-05（进度对齐）
> **状态**: Sprint 1 地基基本完成（TenantMiddleware 运行时阻塞）；Sprint 2 主体完成；Sprint 3-5 部分/未开始

---

## 当前进度对齐（2026-11-05）

状态说明：✅ 完成 / 🟡 部分完成 / 🚧 代码完成但运行时阻塞 / ⛔ 未开始

| 范围 | ✅ 完成 | 🟡 部分 | 🚧 阻塞 | ⛔ 未开始 | 结论 |
|---|---:|---:|---:|---:|---|
| Sprint 1 · 地基搭建 | 29 | 1 | 5 | 0 | 代码基本齐备；多租户运行开关失效，ADAPT-01~04 运行时被阻塞 |
| Sprint 2 · 前端重构 + 异步化 | 5 | 3 | 0 | 0 | 导航/Dashboard/Celery/Redis SSE 已完成；协作与审计为部分完成 |
| Sprint 3 · 差异化功能 | 1 | 2 | 0 | 3 | 运行详情四 Tab 已完成；AI Gateway 后端与触发器未开始 |
| Sprint 4 · 商业化 | 0 | 4 | 0 | 1 | 仅有 Token 汇总与占位 UI；计量/Stripe 未开始 |
| Sprint 5 · 打磨 + 部署 | 1 | 2 | 0 | 3 | 暗色主题已完成；Docker/部署未开始 |
| **合计** | **36** | **12** | **5** | **7** | **60 项中约 60% 完成** |

**关键结论**

- 前端 M0–M5 重构已完成：暗色设计系统、应用壳、Dashboard、工作流/编辑器、运行列表/详情、设置中心、成员/审计、登录与工作空间列表。
- 后端异步链路已落地：Celery 任务投递、RunManager worker 执行、EventBus Redis Pub/Sub 均已有代码。
- DB-05 已完成：10 张业务表统一 `created_by` / `updated_by` / `deleted_at`；工作流、服务商、工作区、成员、API Key 删除改为软删除，查询统一过滤 `deleted_at IS NULL`。
- DB-05 的请求级操作者字段依赖 `TenantContext`；在 INFRA-02 修复前，工作流/服务商/运行的 `created_by` / `updated_by` 可能仍为 NULL（用户/工作空间因显式传 `owner_id` 不受影响）。
- **P0 阻塞**：`core/tenancy.py::is_saas_mode()` 读取 `os.environ`，而 `.env` 由 pydantic-settings 加载，实际 `TENANCY_ENABLED` 没有进入 `os.environ`，导致 `TenantMiddleware` 为 no-op；本地已验证 `settings.TENANCY_ENABLED=True` 但 `is_saas_mode()=False`。这会让 ADAPT-01~04 的 workspace 过滤在运行时失效。
- AI Gateway、Prompt Library、账单目前是前端原型占位；Token/费用计量与 Stripe 未接入。
- Docker / docker-compose / 私有化部署脚本尚未开始。

### 本次对齐的代码证据

| 结论 | 证据 |
|---|---|
| 前端重构完成 | `apps/web/src/features/*`、`shared/components/ui`、`shared/components/AppLayout.tsx`、`styles/tokens.css` |
| Celery + Redis | `apps/api/src/app/core/celery_app.py`、`modules/runs/tasks.py`、`core/engine/event_bus.py` |
| PostgreSQL 迁移特性 | `apps/api/src/app/db/pg.py`、`alembic/versions/0008_pg_concurrent_indexes.py`；PG `0008`、SQLite 全量升级均验证通过 |
| 统一审计字段 | `apps/api/src/app/db/audit.py`、`alembic/versions/0009_audit_fields.py`；10 张业务表列校验通过，软删除测试通过 |
| 四 Tab 运行详情 | `apps/web/src/features/runs/components/RunDetail.tsx` |
| 多租户过滤代码 | `modules/*/repository.py` 均有 `workspace_id` 过滤 |
| 多租户运行时阻塞 | `core/tenancy.py` 的 `is_saas_mode()` 读取 `os.environ`；`.env` 不写入 `os.environ` |
| 未开始 | 仓库内无 `deploy/`、Dockerfile、docker-compose；无 ModelRouter / 预算追踪 |

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

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| DB-01 | 在 `pyproject.toml` 添加 `psycopg[binary]` 和 `asyncpg` 依赖 | `apps/api/pyproject.toml` | — | P0 | ✅ `psycopg[binary]>=3.2.0` + `asyncpg>=0.30.0`（锁定 0.32.0）；运行时仍走同步 SQLAlchemy |
| DB-02 | 创建统一数据库入口，支持 SQLite/PostgreSQL 切换（环境变量 `DATABASE_URL`） | `apps/api/src/app/db/database.py` | DB-01 | P0 | ✅ 实际路径为 `app/db/database.py` |
| DB-03 | 配置 Alembic 迁移，支持 PostgreSQL 特性（UUID、JSONB、CONCURRENTLY） | `apps/api/alembic/` | DB-02 | P0 | ✅ `env.py` 按方言配置；新增 `app/db/pg.py` UUID/JSONB 助手；0008 使用 `CREATE INDEX CONCURRENTLY` 建多租户组合索引，SQLite 自动退回普通索引；现有主键保持 String 兼容存量数据 |
| DB-04 | 所有 models.py 增加 `workspace_id` 外键 + 混合索引 | `apps/api/src/app/modules/*/models.py` | DB-03 | P0 | ✅ workflows/runs/providers/settings/audit/auth 均已加 |
| DB-05 | 全局审计字段统一化（`created_by`, `updated_by`, `deleted_at`） | 所有 models.py | DB-04 | P1 | ✅ 10 张业务表统一 `AuditMixin`；0009 迁移 + 历史回填；工作流/服务商/工作区/成员/API Key 删除改为软删 |

### 1.2 多租户中间件与基础设施

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| INFRA-01 | 创建 `TenantContext`（ContextVar） | `apps/api/src/app/core/tenancy.py` | — | P0 | ✅ |
| INFRA-02 | 创建 `TenantMiddleware`，从 JWT 提取 workspace_id 注入上下文 | `apps/api/src/app/core/tenancy.py` | INFRA-01 | P0 | 🚧 代码存在，但 `is_saas_mode()` 读 `os.environ` 导致中间件 no-op |
| INFRA-03 | tenant-aware session（查询自动注入 workspace 过滤） | `apps/api/src/app/core/tenancy.py` | DB-02, INFRA-01 | P0 | 🟡 实际由各 Repository 显式过滤，未做 Session 自动注入 |
| INFRA-04 | 注册 TenantMiddleware + 全局异常 + CORS | `apps/api/src/app/main.py` | INFRA-02 | P0 | ✅ 已注册；受 INFRA-02 运行时影响 |

### 1.3 Auth 模块（新增）

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| AUTH-01 | 创建 `modules/auth/` 标准五件套 | `apps/api/src/app/modules/auth/` | — | P0 | ✅ |
| AUTH-02 | 定义 User / Workspace / WorkspaceMember / ApiKey 模型 | `modules/auth/models.py` | DB-04 | P0 | ✅ |
| AUTH-03 | 定义 Auth schema | `modules/auth/schemas.py` | AUTH-02 | P0 | ✅ |
| AUTH-04 | bcrypt 密码哈希 + JWT + refresh token | `modules/auth/service.py` | AUTH-03 | P0 | ✅ |
| AUTH-05 | Repository：用户/成员/API Key CRUD | `modules/auth/repository.py` | AUTH-02 | P0 | ✅ |
| AUTH-06 | Router：register/login/refresh/me | `modules/auth/router.py` | AUTH-04, AUTH-05 | P0 | ✅ |
| AUTH-07 | `get_current_user` + `require_role` + `require_workspace_access` | `modules/auth/dependencies.py` | AUTH-06 | P0 | ✅ |
| AUTH-08 | 依赖：passlib/bcrypt/python-jose/python-multipart | `apps/api/pyproject.toml` | — | P0 | ✅ |

### 1.4 Workspace 模块（新增）

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| WS-01 | 创建 `modules/workspaces/` + 五件套 | `apps/api/src/app/modules/workspaces/` | — | P0 | ✅ |
| WS-02 | Role 枚举 + WorkspaceMember 关系扩展 | `modules/workspaces/schemas.py` | AUTH-02 | P0 | ✅ |
| WS-03 | 创建工作空间、成员邀请/移除、角色变更 | `modules/workspaces/service.py` | AUTH-04 | P0 | ✅ |
| WS-04 | Router：`/api/v1/workspaces`（CRUD + 成员管理） | `modules/workspaces/router.py` | WS-03 | P0 | ✅ |

### 1.5 现有模块适配（workspace_id + tenant 隔离）

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| ADAPT-01 | workflows Repository 注入 `workspace_id` 过滤 | `modules/workflows/repository.py`, `service.py` | INFRA-03 | P0 | 🚧 代码完成；运行时受 INFRA-02 阻塞 |
| ADAPT-02 | runs 模块同上 + `triggered_by` | `modules/runs/` | INFRA-03 | P0 | 🚧 代码完成；运行时受 INFRA-02 阻塞 |
| ADAPT-03 | providers 模型密钥归属 workspace | `modules/providers/` | DB-04 | P0 | 🚧 代码完成；运行时受 INFRA-02 阻塞 |
| ADAPT-04 | settings 拆分全局 + 工作空间级 | `modules/settings/` | DB-04 | P1 | 🚧 `app_setting(key, workspace_id)` 复合主键已实现；运行时受 INFRA-02 阻塞 |
| ADAPT-05 | 注册 auth/workspaces router，统一 `/api/v1` | `main.py` | AUTH-06, WS-04 | P0 | ✅ |

### 1.6 前端地基

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| FE-01 | 创建 `features/auth/` 功能模块 | `apps/web/src/features/auth/` | Backend AUTH | P0 | ✅ |
| FE-02 | 登录/注册页面（校验、Loading、错误提示） | `features/auth/components/` | FE-01 | P0 | ✅ 已统一暗色 AuthShell |
| FE-03 | Zustand `useAuthStore` | `features/auth/hooks/useAuthStore.ts` | FE-01 | P0 | ✅ |
| FE-04 | Bearer 注入 + 401 刷新 | `shared/lib/http.ts` | FE-03 | P0 | ✅ |
| FE-05 | 工作空间列表/切换/Dashboard 入口 | `features/workspaces/` | Backend WS | P0 | ✅ 已暗色卡片化 |
| FE-06 | AuthGuard 路由守卫 | `shared/components/AuthGuard.tsx` | FE-03, FE-05 | P0 | ✅ |
| FE-07 | AppLayout：工作空间选择器、订阅状态、用户菜单 | `shared/components/AppLayout.tsx` | FE-05 | P0 | ✅ 已重写为暗色 SaaS 壳 |

### 1.7 契约层更新

| ID | 任务 | 文件 | 依赖 | 优先级 | 状态 |
|----|------|------|------|--------|------|
| CONTRACTS-01 | 更新 `openapi.yaml` | `packages/contracts/openapi.yaml` | 所有 backend 改动 | P1 | ✅ |
| CONTRACTS-02 | 重新生成 TS 类型 | `packages/contracts/src/generated/index.ts` | CONTRACTS-01 | P1 | ✅ `contracts:check` 通过 |

---

## Sprint 2 · 前端重构 + 异步化（W3-W4）

| ID | 任务 | 依赖 | 优先级 | 状态 |
|----|------|------|--------|------|
| ASYNC-01 | 引入 Redis + Celery | Sprint 1 DB | P0 | ✅ `core/celery_app.py` + 依赖已加 |
| ASYNC-02 | RunManager 适配异步 worker | ASYNC-01 | P0 | ✅ `modules/runs/tasks.py` 投递执行 |
| ASYNC-03 | EventBus → Redis Pub/Sub | ASYNC-01 | P0 | ✅ `core/engine/event_bus.py` |
| ASYNC-04 | 协作状态条（锁定/在线成员/变更闪烁） | FE 地基 | P1 | 🟡 已有真实状态条（当前用户+自动保存），无在线成员/锁 |
| ASYNC-05 | 版本 Review 视图（Draft → Ready → Published） | Sprint 1 ADAPT | P1 | 🟡 有 draft/ready、版本抽屉与发布动作；无独立 Published 状态 |
| ASYNC-06 | 审计日志模块 + 查询 API | Sprint 1 | P1 | 🟡 模块/API 完成，登录/工作空间/工作流手动记录；无统一中间件 |
| FE-10 | 导航结构重设计（顶栏 + 侧栏） | FE 地基 | P0 | ✅ 已按原型分组侧栏 + 顶栏 |
| FE-11 | Dashboard 概览页 | Sprint 1 | P1 | ✅ 今日焦点/KPI/趋势/Token 分布/热门工作流/最近运行 |

---

## Sprint 3 · 差异化功能（W5-W6）

| ID | 任务 | 依赖 | 优先级 | 状态 |
|----|------|------|--------|------|
| GATE-01 | AI Gateway：ModelRouter + 路由策略 + 预算追踪 | providers 适配 | P0 | ⛔ 后端未实现 |
| GATE-02 | AI Gateway UI | GATE-01 | P0 | 🟡 预算/路由/性能页已完成，但数据为示例占位 |
| GATE-03 | 运行详情四 Tab | runs 模块 | P0 | ✅ 概览/节点执行/成本分析/调试诊断 |
| GATE-04 | 诊断 Tab：失败分类 + 根因 + 修复建议 | GATE-03 | P1 | 🟡 前端规则分类 + 建议已完成；无自动根因分析 |
| TRIGGER-01 | HTTP / Webhook 触发 API | Sprint 2 ASYNC | P1 | ⛔ 未实现 |
| TRIGGER-02 | 子工作流 / SubWorkflow 节点 | 引擎改造 | P1 | ⛔ 未实现 |

---

## Sprint 4 · 商业化（W7-W8）

| ID | 任务 | 依赖 | 优先级 | 状态 |
|----|------|------|--------|------|
| BILL-01 | 计量中间件：运行次数、Token、存储用量 | runs + providers | P0 | 🟡 `RunListItem.total_tokens` 已补齐；无实时计量中间件 |
| BILL-02 | Stripe Subscription + Usage Metering | BILL-01 | P0 | ⛔ 未实现 |
| BILL-03 | 订阅管理 UI | BILL-02 | P0 | 🟡 设置中心有账单占位卡，无真实数据 |
| TPL-01 | 模板市场 30+ 模板 | workflows 模块 | P1 | 🟡 已有 7 个内置模板 + 模板中心入口 |
| TPL-02 | Prompt Library | LLM 节点 | P1 | 🟡 页面占位，无收藏/版本/效果统计 |

---

## Sprint 5 · 打磨 + 部署（W9-W10）

| ID | 任务 | 依赖 | 优先级 | 状态 |
|----|------|------|--------|------|
| DEPLOY-01 | Dockerfile（api + web + nginx + postgres + redis + worker） | 全部 | P0 | ⛔ 未开始 |
| DEPLOY-02 | docker-compose 一键启动 | DEPLOY-01 | P0 | ⛔ 未开始 |
| DEPLOY-03 | 私有化部署脚本 + 迁移指南 | DEPLOY-01 | P1 | ⛔ 未开始 |
| POLISH-01 | AI Prompt Studio 增强（变量预览/Token 估算/JSON Schema 校验） | 编辑器 | P1 | 🟡 有变量插入、模型参数、最近输出与节点调试；缺 Token 估算/Schema 校验 |
| POLISH-02 | 暗色主题 | UI 系统 | P2 | ✅ 设计令牌 + AntD darkAlgorithm + 全站暗色 |
| DOC-01 | API 文档 + 部署文档 + 用户手册 | 全部 | P1 | 🟡 OpenAPI 与现有 docs 可用；缺部署/用户手册 |

---

## 关键差异与后续建议

### P0：先修多租户运行开关

`apps/api/src/app/core/tenancy.py::is_saas_mode()` 当前读取 `os.environ`：

```python
return os.environ.get("TENANCY_ENABLED", "false").lower() in ("1", "true", "yes")
```

而 `.env` 由 pydantic-settings 加载到 `settings.TENANCY_ENABLED`，不会写入 `os.environ`。本地实测：

- `settings.TENANCY_ENABLED = True`
- `os.environ.TENANCY_ENABLED = None`
- `is_saas_mode() = False`

影响：`TenantMiddleware` 直接放行，`get_workspace_id()` 返回 `None`，各 Repository 的 `workspace_id` 过滤被跳过，工作流/运行/审计等列表可能返回跨工作空间数据。

建议：改为读取 `settings.TENANCY_ENABLED`，并在修复后用两个工作空间的真实账号做回归：
1. 工作流列表只返回本空间数据；
2. 运行记录/审计日志不出现其他空间记录；
3. 跨空间访问返回 403/404。

### 其他建议

- **Sprint 3**：补 `ModelRouter` + 预算追踪后端，用真实数据替换 Gateway 占位；再评估 Webhook 触发与 SubWorkflow。
- **Sprint 4**：先做 BILL-01 计量中间件，再接入 Stripe；模板市场从 7 个内置模板扩到 30+。
- **Sprint 5**：新增 `deploy/`（Dockerfile + docker-compose + nginx），补齐私有化部署与用户手册。
- **DB-05**：统一补 `updated_by` / `deleted_at` 与软删查询，避免后续商业化阶段再改表。
- **POLISH-01**：在 PropertyPanel 增加 Token 估算、变量预览与 JSON Schema 校验。

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
