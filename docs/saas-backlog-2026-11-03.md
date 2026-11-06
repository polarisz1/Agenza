# AgentFlow SaaS 转型 · 执行 Backlog

> **来源**: `docs/saas-strategy-2026-11-03.md` 战略评估
> **版本**: v2.9 · 2026-11-06（TRIGGER-02 Phase B：嵌套节点可观测性）
> **状态**: Sprint 1 地基完成；Sprint 2 主体完成（ASYNC-04 延后）；Sprint 3 AI Gateway、诊断 Tab、HTTP/Webhook 触发、子工作流 Phase A/B 完成

---

## 当前进度对齐（2026-11-05）

状态说明：✅ 完成 / 🟡 部分完成 / 🚧 代码完成但运行时阻塞 / ⛔ 未开始

| 范围 | ✅ 完成 | 🟡 部分 | 🚧 阻塞 | ⛔ 未开始 | 结论 |
|---|---:|---:|---:|---:|---|
| Sprint 1 · 地基搭建 | 35 | 0 | 0 | 0 | 多租户开关与 session 自动过滤均已落地，工作流/运行/服务商/设置的隔离有回归测试 |
| Sprint 2 · 前端重构 + 异步化 | 7 | 1 | 0 | 0 | 审计与版本发布已补齐；协作状态条按决策延后（无下游依赖） |
| Sprint 3 · 差异化功能 | 4 | 2 | 0 | 0 | AI Gateway、诊断 Tab、HTTP/Webhook 触发完成；子工作流 Phase A/B 完成，C 待做 |
| Sprint 4 · 商业化 | 0 | 4 | 0 | 1 | 仅有 Token 汇总与占位 UI；计量/Stripe 未开始 |
| Sprint 5 · 打磨 + 部署 | 1 | 2 | 0 | 3 | 暗色主题已完成；Docker/部署未开始 |
| **合计** | **47** | **9** | **0** | **4** | **60 项中约 78% 完成** |

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
- GATE-02 已落地：Gateway 页面改为真实数据（预算状态、已用/剩余/告警、路由策略编辑、近 30 天模型调用/成功率/延迟/Token/成本），已用浏览器实测登录 → Gateway → 编辑预算弹窗全链路通过。
- GATE-04 已落地：`modules/runs/diagnosis.py` 用确定性规则把错误文本 + 节点配置转成「类别/根因/证据/建议」（预算、鉴权、限流、超时、网络、服务商、JSON 格式、缺失字段、变量、脚本、上游、内部异常），`GET /runs/{id}/diagnosis` 自动返回失败节点与运行级兜底；不调用模型、零额外成本。前端诊断 Tab 已接入该接口，按严重度/类别/置信度渲染证据与建议，建议动作可直接打开节点、重跑、跳转模型配置或 AI Gateway；接口不可用时自动回退本地 `classifyRunError` 规则并提示。
- GATE-04 Phase 2 已落地：新增 `POST /api/v1/runs/{id}/diagnosis/deep` 与前端「AI 深度分析」按钮，**仅在用户点击时**调用模型；调用前先查 Gateway 预算硬停机（402 并给出明确文案），未配置路由时退回第一个可用服务商的默认模型；prompt 经 `core/redact.py` 脱敏（密钥/Bearer/URL 凭据/邮箱）并截断；结果落 `run_deep_analysis` 表兼作缓存（同一 run 重复点击不再计费，可 `refresh=true` 强制重算），Token 计入 Gateway 月度用量口径。迁移 `0013_run_deep_analysis.py`。
- GATE-04 Phase 3 已落地：新增 `GET /api/v1/runs/diagnosis/trends`，按工作流聚合近 N 天已完成运行——复用确定性规则产出「同类失败 Top N」（次数/影响运行数/最近出现/样本运行），并给出每日运行次数、成功率与空输出率（成功产出节点中输出为 None / 空串 / "null" 的占比）趋势；前端诊断 Tab 增加跨运行趋势区（KPI、ECharts 柱线图、Top N 列表与「查看最近一次」跳转），不调用模型、零额外成本。
- TRIGGER-01 Phase A/B 已落地：新增工作空间级 API Key（`af_<key_id>_<secret>`，只存 sha256，明文仅创建时返回一次，owner 才能管理）与 `POST /api/v1/triggers/http/{workflow_id}`；触发只允许已发布版本，立即返回 202 + run_id，Celery 可用时投递队列、无 Celery 时用后台任务执行，支持 `Idempotency-Key`；API Key 依赖在事件循环内注入租户上下文，租户隔离与审计规则已覆盖。迁移 `0014_trigger_api.py`。
- TRIGGER-01 Phase D 代码改造已完成：`RunService` 拆出 `prepare_run` / `execute_prepared_run` / `dispatch_prepared_run`，手动运行与外部触发共用；无 Celery 时通过 `BackgroundTasks` + 独立 Session + 租户上下文执行；Celery worker 改为按 `run.graph_snapshot` 执行（不再读当前草稿图）并注入 `TenantContext`。收尾项见下方「TRIGGER-01 后续」。
- TRIGGER-01 Phase C 已落地：新增 `workflow_trigger` 工作流级 Webhook（每触发器独立 `whsec_` secret，Fernet 加密存储，创建/轮换时只返回一次明文）与管理 API（`/api/v1/triggers` 创建/列表/更新/删除/轮换）；公网入口 `POST /api/v1/webhooks/{trigger_id}` 使用 `X-AgentFlow-Timestamp` + `X-AgentFlow-Signature` 的 HMAC-SHA256 验签（±5 分钟时间窗）、1MB 体积上限、JSONPath 输入映射、`X-Idempotency-Key`/`X-GitHub-Delivery` 幂等与 `last_triggered_at` 记录；验签通过后注入租户上下文，仍只触发已发布版本。迁移 `0015_webhook_trigger.py`。
- TRIGGER-01 Phase E 已落地：设置中心「Webhook / API Key」区接入真实 API Key 管理（仅 owner：列表 / 创建一次明文 / 吊销 / HTTP 触发 curl 示例）；工作流编辑器新增「触发器」抽屉（列表 / 创建含 JSONPath 输入映射 / 启停 / 轮换 Secret 一次展示 / 删除 / 复制 Webhook URL 与 HMAC curl / 最近触发时间）。前端类型全部来自 `@agentflow/contracts`。
- TRIGGER-02 Phase A 已落地：新增 `subworkflow` 节点与 `SubWorkflowExecutor`，只读取同 workspace 的已发布版本快照；父 Run 内嵌套 Scheduler 执行，子 Token 汇总到父节点，父取消/超时自然传导；通过 `workflow_stack` 检测自引用/循环并限制最大深度 5；前端节点库、属性面板（工作流选择 / 输入映射 / 打开子工作流）已接入。
- TRIGGER-02 Phase B 已落地：嵌套节点以 `<父节点>/<子节点>` 路径写入 `node_run`，SSE 事件进入父 Run 通道并带层级名称；`node_run.node_id` 扩宽到 128（迁移 0016）；运行详情按层级缩进、支持子流程分组折叠，诊断优先定位到具体子节点并抑制父级重复条目。
- 顺带修复 ADAPT-04 的真实缺陷：`app_setting` 在 PostgreSQL 上主键仍是 `key` 单列（0004 只加了列），SaaS 下不同 workspace 写同名设置会撞唯一约束；新增 `0010_app_setting_composite_pk.py` 改为复合主键。
- AI Gateway 前后端均已接入真实数据；Prompt Library 与账单仍未接入。
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
| AI Gateway UI | `apps/web/src/features/gateway/api/index.ts`、`components/GatewayPage.tsx`；浏览器实测预算编辑与真实统计 |
| 根因分析（Phase 1） | `modules/runs/diagnosis.py`、`GET /api/v1/runs/{id}/diagnosis`、`tests/test_run_diagnosis.py`（12 类规则 / 运行级兜底 / 未知错误） |
| 诊断 Tab 前端 | `features/runs/api/index.ts::getRunDiagnosis`、`components/RunDetail.tsx`（根因/证据/置信度/建议动作 + 本地规则 fallback） |
| AI 深度分析（Phase 2） | `modules/runs/deep_analysis.py`、`core/redact.py`、`alembic/versions/0013_run_deep_analysis.py`、`tests/test_run_deep_analysis.py`（mock 模型：缓存命中 / 预算 402 / 脱敏 / 无模型 400） |
| 跨运行趋势（Phase 3） | `modules/runs/trends.py`、`GET /api/v1/runs/diagnosis/trends`、`tests/test_run_diagnosis_trends.py`；前端 `RunDetail.tsx` 趋势区（KPI / ECharts 柱线图 / Top N） |
| API Key + HTTP 触发（TRIGGER-01 A/B） | `modules/auth`（ApiKeyService + `/api/v1/api-keys`）、`modules/triggers/*`、`POST /api/v1/triggers/http/{workflow_id}`、`alembic/versions/0014_trigger_api.py`；`tests/test_api_keys.py`、`tests/test_http_trigger.py`（发布门禁 / 202 / 幂等 / 租户隔离） |
| Webhook 触发器（TRIGGER-01 C） | `workflow_trigger`、`/api/v1/triggers` 管理、`POST /api/v1/webhooks/{trigger_id}`、`alembic/versions/0015_webhook_trigger.py`；`tests/test_webhook_trigger.py`（验签 / 时间窗 / 映射 / 幂等 / 禁用 / 轮换） |
| 前端密钥/触发器管理（TRIGGER-01 E） | `features/settings/components/ApiKeysPanel.tsx`（列表 / 创建一次明文 / 吊销 / HTTP curl）、`features/workflows/components/TriggerDrawer.tsx`（创建 / 启停 / 轮换 / 删除 / 复制 URL 与 curl / 最近触发）；`shared/lib/http.ts` 增加 `patch` |
| 子工作流（TRIGGER-02 A/B） | `workflows/schemas.py::SubWorkflowConfig`、`core/engine/executors/subworkflow.py`、`core/engine/contexts.py` + `scheduler.py` + `manager.py`（loader / workflow_stack / 节点前缀回调）、`runs/service.py::_make_subworkflow_loader`、`alembic/versions/0016_node_run_node_id_width.py`；前端 `types.ts` / `nodes/SubWorkflowNode.tsx` / `PropertyPanel.tsx` / `runs/nodeHierarchy.ts` / `RunDetail.tsx`；`tests/test_subworkflow.py`（发布门禁 / 映射 / 递归 / 深度 / 租户 / 嵌套节点 / SSE / 诊断） |
| app_setting 复合主键 | `apps/api/alembic/versions/0010_app_setting_composite_pk.py`；PG 已在 `0010 (head)` |
| 未开始 | 仓库内无 `deploy/`、Dockerfile、docker-compose；SubWorkflow Phase C（独立子运行记录）未实现 |

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
| GATE-02 | AI Gateway UI | GATE-01 | P0 | ✅ 预算/路由/性能页已接 `/api/v1/gateway` 真实数据；支持编辑预算、路由增删改、按 30 天统计 |
| GATE-03 | 运行详情四 Tab | runs 模块 | P0 | ✅ 概览/节点执行/成本分析/调试诊断 |
| GATE-04 | 诊断 Tab：失败分类 + 根因 + 修复建议 | GATE-03 | P1 | ✅ 确定性规则 + 前端诊断 Tab；Phase 2 按需 AI 深度分析（预算 402 / 缓存 / 脱敏 / 迁移 0013）；Phase 3 跨运行趋势（同类失败 Top N / 成功率 / 空输出率） |
| TRIGGER-01 | HTTP / Webhook 触发 API | Sprint 2 ASYNC | P1 | 🟡 Phase A/B/C/E 完成：API Key + HTTP 触发 + Webhook（HMAC/时间窗/映射/幂等/轮换）+ 前端管理；Phase D 生产 Celery 收尾待做 |
| TRIGGER-02 | 子工作流 / SubWorkflow 节点 | 引擎改造 | P1 | 🟡 Phase A/B 完成：内联执行 + 发布门禁 + 输入映射 + 递归/深度/Token + 嵌套节点可观测性；Phase C（独立运行记录）待做 |

### GATE-04 后续增强（未纳入验收，P2）

- [ ] 运行失败进入详情页时自动切到「调试诊断」Tab（当前默认概览）。
- [ ] 失败后可选的自动 AI 深度分析（默认关闭，避免无人值守时自动计费）。
- [ ] 趋势范围切换：当前工作流 / 整个 workspace（后端已支持不传 `workflow_id`）。
- [ ] 诊断结果反馈闭环：有用 / 无用 + 备注，用于后续规则与 Prompt 优化。
- [ ] 趋势按本地时区分桶，并放宽 500 运行 / 200 失败运行的采样上限（分页或预聚合）。

### TRIGGER-01 后续（Phase D 收尾）

- [x] Phase C：Webhook 触发器（每触发器 secret、HMAC 签名 + 时间窗、输入映射、secret 轮换）。
- [x] Phase E：API Key 与触发器前端管理（创建/复制一次/吊销、curl 示例、最近触发）。
- [ ] Phase D 收尾：生产环境强制 Celery（或多实例启动告警），避免进程内后台任务导致并发闸门只在单实例生效。
- [ ] Phase D 收尾：真实 Redis + Celery worker 联调（当前单测只覆盖无 broker 的后台执行路径）。
- [ ] 触发并发策略：同一工作流已有运行中时当前返回 409，后续按需要增加排队/去重策略。
- [ ] 幂等竞态加固：极端并发下先占位 trigger_request 再创建 run，彻底避免重复 run。

### TRIGGER-02 子工作流 / SubWorkflow（Phase A/B 已落地，C 待做）

**目标**：把同 workspace 的已发布工作流封装为可复用节点，父工作流通过显式输入/输出映射调用，减少重复编排，让复杂流程可以拆成稳定模块。

#### 功能范围

| 能力 | 说明 | 优先级 | 阶段 |
|---|---|---|---|
| 子工作流节点 | 画布上选择同 workspace 的另一个工作流作为节点执行 | P0 | A |
| 输入映射 | 子工作流 input key → 父级 `{{ 节点.字段 }}` 模板或字面量；未映射的 key 使用子工作流默认值 | P0 | A |
| 输出引用 | 子工作流 Output 结果作为节点输出，供下游 `{{ 子工作流节点.字段 }}` 使用 | P0 | A |
| 版本固定 | 只执行 `published_version_id` 对应的版本快照，编辑中的草稿不参与 | P0 | A |
| 运行门禁 | 子工作流不存在 / 未发布 / 跨 workspace / 缺必填输入 → 节点失败并给出可读错误 | P0 | A |
| 递归保护 | 自引用、A→B→A、超过最大嵌套深度（默认 5）→ 拦截 | P0 | A |
| 失败/取消/超时 | 子失败 → 父节点 failed；父取消或超时能终止子执行 | P0 | A |
| Token 汇总 | 子工作流内部 Token 累加到父节点与父运行 | P0 | A |
| 子节点可观测 | 运行详情可展开子工作流内部节点、独立耗时与错误 | P1 | B |
| 独立运行记录 | 子运行进入运行列表，可跳转父子运行 | P2 | C |

**非目标（本项不做）**：

- Foreach / 循环体、批量并行调用同一子工作流。
- 子工作流独立计费、配额与审计主体。
- 在父画布内直接编辑子工作流（只提供「打开子工作流」跳转）。
- 引用未发布的草稿版本。

#### 节点契约

后端 `NodeType` 增加 `subworkflow`，判别联合新增 `SubWorkflowConfig`：

```python
class SubWorkflowConfig(NodeCommonConfig):
    workflow_id: str = ""
    # 子工作流 input key → 父级模板（{{ 节点.字段 }}）或字面量
    input_mapping: dict[str, str] | None = None
    version_policy: Literal["published"] = "published"
```

图节点示例：

```json
{
  "id": "n_ab12cd34",
  "type": "subworkflow",
  "name": "摘要子流程",
  "config": {
    "workflow_id": "wf_xxxxxxxx",
    "input_mapping": {
      "text": "{{ 输入1.text }}",
      "lang": "zh-CN"
    },
    "version_policy": "published",
    "enabled": true,
    "retry": 0,
    "timeout_s": 300
  }
}
```

约定：

- 只允许引用同 workspace 且 `published_version_id` 非空的工作流；跨租户按 404 处理。
- 子工作流必须包含 input/output 节点（沿用现有 `MISSING_INPUT` / `MISSING_OUTPUT` 阻断规则）。
- 输出取子工作流 Output 节点结果；`node_output_fields` 对 `subworkflow` 返回 `None`（形状无法静态推断），避免字段误报。
- `input_mapping` 的值支持 `{{ }}` 模板与字面量；模板由父级执行器统一解析。
- 前端节点类型从契约派生，新增类型后 `NODE_META` / `DEFAULT_CONFIG` / 节点组件会编译报错，必须同步补齐。

#### 执行模型（分三阶段）

**Phase A · 内联执行（MVP，已落地，无数据库迁移）**

- [x] `SubWorkflowExecutor` + `NodeContext.subworkflow_loader`：loader 由 `RunService.execute_prepared_run` 注入，内部自建 Session + 租户上下文，按 workspace 读取子工作流已发布版本快照。
- [x] 父 Run 内创建嵌套 Scheduler（run_id 命名空间 `<parent_run_id>/<node_id>`），复用现有 Kahn 调度、变量解析、超时/重试。
- [x] 调用栈携带已执行 workflow_id 集合，检测自引用/A→B→A；最大嵌套深度默认 5（`MAX_SUBWORKFLOW_DEPTH`）。
- [x] 子工作流失败 → 父节点 failed，错误前缀「子工作流『name』失败：」；缺必填输入/未发布/跨租户立即失败。
- [x] Token 汇总：子节点 `tokens_in/out` 累加到父节点 `NodeResult` 与父运行。
- [x] 取消/超时：父 Scheduler 取消时终止嵌套执行；子工作流节点自身的 `timeout_s` 覆盖整个子执行。
- [x] MVP 只把子工作流节点本身写入 `node_run`，子内部节点不落库（Phase B 已补齐）。

**Phase B · 嵌套可观测性（已落地）**

- [x] 子节点事件加前缀 `<node_id>/<child_node_id>`，SSE 与 NodeRun 同步记录；节点名称带 `父 / 子` 层级。
- [x] 迁移 `0016_node_run_node_id_width.py`：`node_run.node_id` String(24) → String(128)（覆盖 5 层嵌套）。
- [x] 运行详情按层级缩进展示子节点，支持子流程分组展开/折叠；诊断优先定位到子节点并抑制父级重复条目。

**Phase C · 独立运行记录（按需）**

- [ ] `run` 增加 `parent_run_id` / `parent_node_id`，`trigger` 增加 `subworkflow`。
- [ ] 调整 `uq_run_running_per_workflow`：当前全局唯一会让同一子工作流被并发调用时 409，需按父运行隔离或移除子运行约束（评估对现有手动串行策略的影响）。
- [ ] 子运行进入运行列表、诊断与趋势；Celery 多实例下父子状态同步。

#### 关键约束与风险

| 约束 | 影响 | 处理 |
|---|---|---|
| `uq_run_running_per_workflow` 全局唯一 | 独立子运行模型并发调用同一子工作流会 409 | Phase A 内联规避；Phase C 再评估索引 |
| `NodeContext` 无 DB Session | executor 无法直接读取子工作流 | 注入 `subworkflow_loader` 回调，保持引擎与仓储解耦 |
| `node_run.node_id` String(24) | 嵌套前缀后可能超长 | Phase B 已迁移到 128 |
| 校验器无法静态推断子输出字段 | 跨工作流变量校验会误报或漏报 | `node_output_fields` 返回 `None`；运行时校验输入/输出 |
| `core/engine/` 属 AGENTS §8 保护目录 | 改动需影响评估 | commit message 注明引擎边界与回归范围 |
| 多租户隔离 | 不能引用其他 workspace 的工作流 | loader 按 `workspace_id` 过滤，跨租户 404 |
| 递归/循环引用 | 无限执行、栈溢出 | 运行时调用栈 + 深度上限；保存时可选静态告警 |
| 运行中编辑子工作流 | 结果不可复现 | 只读 `published_version_id` 快照，忽略草稿 |

#### 验收清单

- [x] 后端 `NodeType` / `SubWorkflowConfig` / 判别联合登记，`pnpm contracts:generate && pnpm contracts:build && pnpm contracts:check` 通过。
- [x] 前端节点库出现「子工作流」，属性面板可选择工作流、编辑输入映射、跳转打开子工作流。
- [x] 未发布/不存在/跨 workspace 的子工作流无法运行，提示明确。
- [x] 子工作流必填输入缺失时拒绝运行并列出字段。
- [x] 子输出可被下游 `{{ 子工作流节点.字段 }}` 引用。
- [x] 自引用、A→B→A、深度超限被拦截。
- [x] 子工作流失败 → 父运行 failed，错误包含子工作流名称与原因。
- [x] 父取消/超时能终止子执行；Token 汇总正确（依赖 asyncio 取消传播与嵌套 Token 累加）。
- [x] 子工作流内部条件分支/禁用节点行为与独立运行一致（复用同一 Scheduler）。
- [x] Phase B 后运行详情可展开/折叠子节点，SSE 与诊断可定位到具体子节点。

#### 测试计划

- 后端 `tests/test_subworkflow.py` 已覆盖：发布门禁、缺必填输入、跨租户、自引用、深度上限、输入映射、嵌套 NodeRun 路径、父 Run SSE、子节点失败诊断。
- 待补用例：Token 汇总（含 LLM 节点）、取消传播、子图条件分支 / 禁用节点。
- 前端 `features/workflows/types.test.ts`：新增节点的 meta/default/summary 与 `input_mapping` 往返；`features/runs/nodeHierarchy.test.ts`：层级/折叠纯函数。
- 契约漂移：`pnpm contracts:check`；后端全量 `pytest`（241 passed）、前端 `vitest`（84 passed）。

#### 现状与前置条件

- ✅ 已具备：`subworkflow` 节点契约、子工作流 loader、嵌套执行与递归/深度保护、嵌套 NodeRun/SSE 可观测性、运行详情层级展示与折叠、前端节点注册与输入映射 UI、契约生成链。
- ✅ 已复用：发布版本与版本快照（ASYNC-05）、Kahn 调度、变量解析、取消/超时/重试、Token 统计、租户上下文。
- ⛔ 尚缺：Phase C（`parent_run_id`、独立子运行记录、`uq_run_running_per_workflow` 策略调整）。

#### 已确认口径（Phase A/B 实现）

1. 只允许引用**已发布版本**（与 TRIGGER-01 一致，保证可复现）。
2. Phase A 子节点内部暂不落库；Phase B 已补齐嵌套 NodeRun 与 SSE，无需再改执行模型。

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

- **Sprint 3**：TRIGGER-01 的 HTTP 触发、Webhook 与前端管理均已完成，剩余 Phase D 生产 Celery 收尾；TRIGGER-02 Phase A/B（子工作流内联执行 + 嵌套可观测性）已完成，Phase C 独立运行记录按需推进。
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
