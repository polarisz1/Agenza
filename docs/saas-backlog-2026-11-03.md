# AgentFlow SaaS 转型 · 执行 Backlog

> **来源**: `docs/saas-strategy-2026-11-03.md` 战略评估
> **版本**: v1.7 · 2026-11-05（GATE-01 后端完成）
> **状态**: Sprint 1 地基完成；Sprint 2 主体完成（ASYNC-04 延后）；Sprint 3 开始（AI Gateway 后端已落地）

---

## 当前进度对齐（2026-11-05）

状态说明：✅ 完成 / 🟡 部分完成 / 🚧 代码完成但运行时阻塞 / ⛔ 未开始

| 范围 | ✅ 完成 | 🟡 部分 | 🚧 阻塞 | ⛔ 未开始 | 结论 |
|---|---:|---:|---:|---:|---|
| Sprint 1 · 地基搭建 | 35 | 0 | 0 | 0 | 多租户开关与 session 自动过滤均已落地，工作流/运行/服务商/设置的隔离有回归测试 |
| Sprint 2 · 前端重构 + 异步化 | 7 | 1 | 0 | 0 | 审计与版本发布已补齐；协作状态条按决策延后（无下游依赖） |
| Sprint 3 · 差异化功能 | 2 | 2 | 0 | 2 | AI Gateway 后端（ModelRouter/预算/统计）已完成；Gateway UI 与触发器待做 |
| Sprint 4 · 商业化 | 0 | 4 | 0 | 1 | 仅有 Token 汇总与占位 UI；计量/Stripe 未开始 |
| Sprint 5 · 打磨 + 部署 | 1 | 2 | 0 | 3 | 暗色主题已完成；Docker/部署未开始 |
| **合计** | **45** | **9** | **0** | **6** | **60 项中 75% 完成** |

**关键结论**

- 前端 M0–M5 重构已完成：暗色设计系统、应用壳、Dashboard、工作流/编辑器、运行列表/详情、设置中心、成员/审计、登录与工作空间列表。
- 后端异步链路已落地：Celery 任务投递、RunManager worker 执行、EventBus Redis Pub/Sub 均已有代码。
- DB-05 已完成：10 张业务表统一 `created_by` / `updated_by` / `deleted_at`；工作流、服务商、工作区、成员、API Key 删除改为软删除，查询统一过滤 `deleted_at IS NULL`。
- INFRA-02 已修复：`is_saas_mode()` 改为读 `settings.TENANCY_ENABLED`；`TenantMiddleware` 增加 OPTIONS/静态资源 bypass，并修复 `"/"` 前缀导致全路径放行的 bug；access token 类型校验后 refresh token 不再能当 access token 用。
- 多租户运行时已回归：`tests/test_tenancy_middleware.py` 覆盖无 token 401、两个 workspace 的工作流/运行/服务商/设置相互不可见、`created_by` 来自 `TenantContext`、请求结束清理 ContextVar。
- INFRA-03 已落地：`database.py` 注册 `Session.do_orm_execute` 监听，SaaS 模式下自动给业务模型的 ORM SELECT 追加 `workspace_id`（`with_loader_criteria`），Repository 的显式过滤保留作为第一道防线；`user/workspace/workspace_member/api_key` 刻意排除，保证登录与工作空间切换可用，运维跨租户查询用 `execution_options(include_all_workspaces=True)` 绕过。
- ASYNC-06 已落地：`AuditMiddleware` 统一记录成功的写操作（工作流增删改/复制/恢复、运行发起取消、服务商增删改、设置更新、工作空间与成员管理），自动带 `TenantContext` 的 user/workspace；失败请求与只读请求不落库，审计写入失败不影响主请求。
- ASYNC-05 已落地：`workflow.published_version_id / published_at` 与 `status`（可运行性）分离，新增 `POST /workflows/{id}/publish`（可指定历史版本）与 `unpublish`；列表/详情返回 `has_unpublished_changes`，编辑器状态条区分 Draft / Ready / Published（有未发布修改），版本抽屉可标记并发布指定版本。
- ASYNC-04 决策：暂缓到 Sprint 4/5，原因是没有下游依赖、在线状态/编辑锁依赖 Redis TTL 与跨实例广播（Sprint 5 才部署 Redis），提前做会在多实例上线时返工。**代价**：当前同一工作流并发编辑是 last-write-wins，试点期建议约定一个工作流同时只由一人编辑，后续实现 ASYNC-04 时用乐观锁补齐。
- GATE-01 已落地：新增 `modules/gateway/`（配置 + 路由策略 + 用量统计）与 `core/providers/router.py` 的 `ModelRouter`；`/api/v1/gateway` 提供 config / routes / usage / resolve；运行与单节点调试前按策略自动选模型，预算到硬停机阈值时 LLM/EXTRACT 节点直接失败并给出明确提示。
- 顺带修复 ADAPT-04 的真实缺陷：`app_setting` 在 PostgreSQL 上主键仍是 `key` 单列（0004 只加了列），SaaS 下不同 workspace 写同名设置会撞唯一约束；新增 `0010_app_setting_composite_pk.py` 改为复合主键。
- AI Gateway 后端已接入真实用量；Gateway 前端页面仍为示例数据（GATE-02），Prompt Library 与账单未接入。
- Docker / docker-compose / 私有化部署脚本尚未开始。

### 本次对齐的代码证据

| 结论 | 证据 |
|---|---|
| 前端重构完成 | `apps/web/src/features/*`、`shared/components/ui`、`shared/components/AppLayout.tsx`、`styles/tokens.css` |
| Celery + Redis | `apps/api/src/app/core/celery_app.py`、`modules/runs/tasks.py`、`core/engine/event_bus.py` |
| PostgreSQL 迁移特性 | `apps/api/src/app/db/pg.py`、`alembic/versions/0008_pg_concurrent_indexes.py`；PG `0008`、SQLite 全量升级均验证通过 |
| 统一审计字段 | `apps/api/src/app/db/audit.py`、`alembic/versions/0009_audit_fields.py`；10 张业务表列校验通过，软删除测试通过 |
| 四 Tab 运行详情 | `apps/web/src/features/runs/components/RunDetail.tsx` |
| 多租户运行时 | `apps/api/src/app/core/tenancy.py`（`is_saas_mode` 读 settings）、`tests/test_tenancy_middleware.py`（4 类隔离断言） |
| session 自动过滤 | `core/tenancy.py::install_tenant_query_filter`、`db/database.py` 注册；`test_session_auto_filters_workspace` 验证无显式过滤的查询也按 workspace 截断 |
| 统一审计 | `modules/audit/middleware.py`、`main.py` 注册；`tests/test_audit_middleware.py` 验证动作/操作者/归属 workspace、只读与失败请求不落库 |
| 工作流发布 | `alembic/versions/0011_workflow_publish.py`（PG 已在 `0011 (head)`）、`workflows/service.py::publish`、`tests/test_workflow_publish.py`；前端 `WorkflowEditor` / `VersionDrawer` / `WorkflowList` / `Dashboard` |
| AI Gateway 后端 | `core/providers/router.py`、`modules/gateway/*`、`alembic/versions/0012_gateway.py`；`tests/test_gateway.py`（路由/配置/用量/预算硬停机） |
| app_setting 复合主键 | `apps/api/alembic/versions/0010_app_setting_composite_pk.py`；PG 已在 `0010 (head)` |
| 未开始 | 仓库内无 `deploy/`、Dockerfile、docker-compose；Webhook 触发与 SubWorkflow 未实现 |

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
| INFRA-02 | 创建 `TenantMiddleware`，从 JWT 提取 workspace_id 注入上下文 | `apps/api/src/app/core/tenancy.py` | INFRA-01 | P0 | ✅ `is_saas_mode()` 改读 `settings.TENANCY_ENABLED`；新增 OPTIONS/静态资源 bypass，修复 `"/"` 前缀放行全路径；校验 access token 类型；回归测试 `tests/test_tenancy_middleware.py` |
| INFRA-03 | tenant-aware session（查询自动注入 workspace 过滤） | `apps/api/src/app/core/tenancy.py` | DB-02, INFRA-01 | P0 | ✅ `Session.do_orm_execute` + `with_loader_criteria` 自动过滤 7 个业务模型；显式过滤保留；`include_all_workspaces=True` 可绕过 |
| INFRA-04 | 注册 TenantMiddleware + 全局异常 + CORS | `apps/api/src/app/main.py` | INFRA-02 | P0 | ✅ 已注册，SaaS 模式下运行时验证通过 |

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
| ADAPT-01 | workflows Repository 注入 `workspace_id` 过滤 | `modules/workflows/repository.py`, `service.py` | INFRA-03 | P0 | ✅ 回归测试验证两个 workspace 互相不可见，`created_by` 取 `TenantContext` |
| ADAPT-02 | runs 模块同上 + `triggered_by` | `modules/runs/` | INFRA-03 | P0 | ✅ 运行列表/详情按 workspace 隔离，跨租户取详情返回 404 |
| ADAPT-03 | providers 模型密钥归属 workspace | `modules/providers/` | DB-04 | P0 | ✅ 服务商列表按 workspace 隔离；密钥仍 Fernet 加密存储 |
| ADAPT-04 | settings 拆分全局 + 工作空间级 | `modules/settings/` | DB-04 | P1 | ✅ `app_setting(key, workspace_id)` 复合主键；新增 0010 迁移修正 PostgreSQL 主键，设置按 workspace 隔离 |
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
| ASYNC-04 | 协作状态条（锁定/在线成员/变更闪烁） | FE 地基 | P1 | 🟡 已决定暂缓：现有状态条可显示当前用户与自动保存；在线成员/锁依赖 Redis TTL 与跨实例广播，建议随 Sprint 5 的 Redis 部署一起做；无下游任务依赖 |
| ASYNC-05 | 版本 Review 视图（Draft → Ready → Published） | Sprint 1 ADAPT | P1 | ✅ 发布状态独立字段 + publish/unpublish API；编辑器状态条与版本抽屉支持发布/取消发布/标记已发布版本 |
| ASYNC-06 | 审计日志模块 + 查询 API | Sprint 1 | P1 | ✅ 模块/API/前端页面 + `AuditMiddleware` 统一记录写操作；失败与只读请求不落库 |
| FE-10 | 导航结构重设计（顶栏 + 侧栏） | FE 地基 | P0 | ✅ 已按原型分组侧栏 + 顶栏 |
| FE-11 | Dashboard 概览页 | Sprint 1 | P1 | ✅ 今日焦点/KPI/趋势/Token 分布/热门工作流/最近运行 |

---

## Sprint 3 · 差异化功能（W5-W6）

| ID | 任务 | 依赖 | 优先级 | 状态 |
|----|------|------|--------|------|
| GATE-01 | AI Gateway：ModelRouter + 路由策略 + 预算追踪 | providers 适配 | P0 | ✅ `modules/gateway/`（config/routes/usage/resolve）+ `core/providers/router.py`；运行与单节点调试按策略路由，预算硬停机拦截 LLM/EXTRACT；迁移 0012 |
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

### 已完成：多租户运行开关（原 P0）

`apps/api/src/app/core/tenancy.py::is_saas_mode()` 原来读取 `os.environ`：

```python
return os.environ.get("TENANCY_ENABLED", "false").lower() in ("1", "true", "yes")
```

而 `.env` 由 pydantic-settings 加载到 `settings.TENANCY_ENABLED`，不会写入 `os.environ`，
导致 `TenantMiddleware` 实际为 no-op、`get_workspace_id()` 返回 `None`。

已修复为读取 `settings.TENANCY_ENABLED`，同时处理：

1. `OPTIONS` 预检与 `/docs`、`/health`、`/assets` 等 bypass（原来 `"/"` 走 `startswith` 会放行所有路径）；
2. 只接受 `type=access` 的 JWT，refresh token 不能当访问令牌用；
3. 请求结束清理 `ContextVar`（`clear_tenant()`）。

回归测试 `apps/api/tests/test_tenancy_middleware.py` 已覆盖：无 token 401、两个工作空间的工作流/运行/服务商/设置互不可见、`created_by` 来自 `TenantContext`、跨租户取运行详情返回 404。

顺带修复：`app_setting` 在 PostgreSQL 上主键仍是 `key` 单列（0004 只加了 `workspace_id` 列），
工作空间级设置会撞唯一约束；`0010_app_setting_composite_pk.py` 改为复合主键 `(key, workspace_id)`。

### 其他建议

- **Sprint 3**：GATE-02 把 Gateway UI 接到 `/api/v1/gateway`（配置/路由/用量/resolve），替换示例数据；再评估 Webhook 触发（TRIGGER-01）与 SubWorkflow（TRIGGER-02）。
- **Sprint 4**：先做 BILL-01 计量中间件，再接入 Stripe；模板市场从 7 个内置模板扩到 30+。
- **Sprint 5**：新增 `deploy/`（Dockerfile + docker-compose + nginx），补齐私有化部署与用户手册。
- **ASYNC-04（延后）**：随 Sprint 5 的 Redis 一起做「在线成员 + 编辑锁」；变更闪烁/在线光标需要按 workflow 的 SSE 通道，单独立项。落地前同一工作流按单人编辑使用，避免 last-write-wins 覆盖。
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
