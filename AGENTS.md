# AGENTS.md · Agenza（开源自托管版）

> **本文件是 AI 协作时的最高优先级约定。修改前请先阅读并遵守以下约束。**
> 违反任何硬性约束视为错误提交，必须在首次 commit 前修复。

---

## 0. 项目方向

**Agenza 是一个个人维护的开源、自托管 AI 工作流编排平台。商业化 SaaS 目标已暂停，多租户 / 多工作空间能力保留为可选的部署模式。**

| 项 | 现状 |
|---|---|
| 产品形态 | 自托管 Web（Docker Compose，单容器 + PostgreSQL）；可选多用户工作空间；旧桌面壳保留但不再演进 |
| 当前阶段 | 开源发布与自托管体验完善：License / README / Docker 部署 / 首用户初始化 |
| 规划来源 | `README.md`（当前定位与路线图）；`docs/saas-*.md` 仅作历史设计参考 |

> `docs/` 下 SaaS 战略、产品设计与 Sprint 清单已归档，不再作为当前开发依据。历史评审证据
> （`code-review-*.md`）、性能基线、依赖审计、Provider 验收矩阵继续保留。

**规划优先级**：本文件（硬约束）> `README.md`（当前定位与路线图）> `docs/` 历史设计。

---

## 1. 目录结构（硬性约束）

```
Agenza/
├── apps/
│   ├── web/          # React 前端 → apps/web/src/features/<feature>/
│   └── api/          # FastAPI 后端 → apps/api/src/app/modules/<feature>/
├── packages/contracts/  # OpenAPI 契约 → 单一事实源
├── deploy/           # Docker Compose 环境变量示例
├── electron/         # 旧桌面壳，保留但不再演进
├── pyinstaller/      # 冻结：仅为旧桌面安装包保留，不再新增适配
├── tools/scripts/    # 辅助脚本
└── docs/             # 规划与工程记录
```

---

## 2. Python 后端（apps/api）约束

### 2.1 模块组织（**禁止违反**）

```
apps/api/src/app/modules/<feature>/
├── __init__.py
├── router.py         # 本 feature 的全部 FastAPI 路由
├── service.py        # 业务逻辑编排
├── repository.py     # SQLAlchemy ORM 查询
├── schemas.py        # Pydantic v2 schema（OpenAPI 单一事实源）
├── models.py         # SQLAlchemy 模型
└── dependencies.py   # 可选：feature 内部的 FastAPI 依赖（如 auth）
```

**禁令：**
- ❌ **禁止**在 `modules/` 下建 `routers/`、`services/`、`repositories/` 平铺目录
- ❌ **禁止**跨 feature 直接 import 对方的 `repository.py`（只能通过 `service.py` 抽象）
- ✅ 横切关注点（DB session、配置、日志、执行引擎、服务商适配、多租户）统一放 `src/app/core/`

### 2.2 工作空间隔离（多用户模式核心，**禁止违反**）

- 所有业务表**必须**有 `workspace_id`；`nullable=True` 仅用于兼容桌面旧库，多用户模式下新写入不得为空
- 所有 Repository 查询**必须**显式带 `workspace_id` 过滤；新增查询不允许返回跨 workspace 数据
- 租户上下文**只能**来自 `app/core/tenancy.py` 的 `TenantContext` / `get_workspace_id()`
- ❌ **禁止**信任请求 body / query / path 里用户自报的 `workspace_id` 作为授权依据
- ❌ **禁止**在 Service 层绕过 `require_workspace_access` 直接操作他租户资源
- 新增写操作必须记录 `created_by` / `updated_by`；删除走 `deleted_at` 软删

> 当前状态：`workspace_id` 列已加到 workflows / runs / providers / settings / auth 模型，
> `TenantMiddleware` 已注册；Repository 层的过滤属于 `ADAPT-01~04` 待完成项。
> 改任何模块前先看 README 路线图或当前任务说明，避免重复实现或写出未过滤查询。

### 2.3 路由与版本

- 新路由统一 `/api/v1/<resource>`（auth、workspaces 已按此落地）
- 旧 `/api/*` 仅作桌面兼容保留，**新功能禁止**再加旧前缀
- 所有新 router 必须在 `apps/api/src/app/main.py` 注册

### 2.4 数据库与迁移

- 自托管生产库为 **PostgreSQL**；SQLite 仅用于本地开发与旧桌面版
- 统一入口 `apps/api/src/app/db/database.py`，通过环境变量 `DATABASE_URL` 切换
  （`psycopg[binary]` 已引入；backlog 里的 `core/database.py` 属于旧路径，以现路径为准）
- 所有 schema 变更**必须**写 alembic 迁移；❌ **禁止**用 `create_all()` 兜底在建表路径上新增结构
- PostgreSQL 特性：UUID 主键、JSONB、`CREATE INDEX CONCURRENTLY`；索引命名 `ix_<table>_<cols>`

### 2.5 执行引擎

引擎代码在 `src/app/core/engine/`：
- `manager.py` — RunManager（运行注册表、取消、并发闸门）
- `scheduler.py` — Kahn 拓扑分层调度
- `registry.py` — NodeExecutor 注册表
- `contexts.py` — NodeContext + NodeResult
- `event_bus.py` — 事件总线 → SSE
- `variable.py` — 变量解析器 `{{ source.field }}`
- `validators.py` — 图校验器
- `executors/` — 节点执行器

**生产部署追加约束：**
- 引擎不直接调模型，统一走 `core/providers/`；AI Gateway 的 `ModelRouter` 只能加在 providers **之上**，
  executors 不得 import 具体 SDK 或硬编码模型名
- 异步化：多实例部署时 API 进程只做任务投递，长任务交给 Celery worker；❌ **禁止**在请求线程里阻塞执行工作流
- EventBus 迁 Redis Pub/Sub 后，多实例 SSE 广播不得依赖进程内内存

### 2.6 安全基线

1. 密码用 bcrypt 哈希（passlib）；JWT 分 access / refresh，敏感信息不入 payload
2. API Key 只存哈希，明文仅在创建时返回一次
3. 模型密钥按 workspace 归属存储，Fernet 加密，明文永不入库
4. 多租户查询必须过滤 `workspace_id`（见 2.2），审计日志不得由业务代码绕过
5. Python 脚本节点用独立子进程（`python -I -S`），工作目录为临时目录
6. 所有文件操作走 `Path.resolve()` + 白名单根目录，禁止路径穿越
7. 生产环境强制 HTTPS；本地开发默认只监听 `127.0.0.1`
8. `CORS_ORIGINS` 必须显式配置，禁止生产使用 `*`

---

## 3. React 前端（apps/web）约束

### 3.1 功能模块组织（**禁止违反**）

```
apps/web/src/features/<feature>/
├── components/       # 仅本 feature 使用的组件
├── hooks/            # 仅本 feature 使用的 hooks
├── api/              # 本 feature 的 API 调用（类型从 @agenza/contracts 导入）
├── types.ts          # 本 feature 内部类型（不对外暴露）
└── index.tsx         # 入口，导出 Route 对象
```

**禁令：**
- ❌ 业务组件放进 `src/shared/`（shared 只放跨 feature 通用 UI、hooks、工具）
- ❌ feature 之间直接 import 对方的 `api/` 或 `components/`
- ❌ 手写 API 类型（全部从 `@agenza/contracts` 导入）

### 3.2 Shared 边界

```
apps/web/src/shared/
├── components/       # AppLayout、AuthGuard、WorkspaceSwitcher 等跨 feature UI
├── hooks/            # useDebounce、useEventSource 等
├── utils/            # request/http（Bearer 注入、401 刷新）、formatters
└── lib/              # axios 实例、dayjs 配置
```

- ❌ **禁止** `shared/` 反向依赖 `features/`
- ❌ **禁止** 在 `shared/` 写业务感知逻辑

### 3.3 鉴权与工作空间上下文

- 所有需要登录的页面经 `AuthGuard`；token 由 `features/auth` 的 store 管理
- HTTP 统一走 `shared/utils/http.ts`：自动注入 `Authorization: Bearer`，401 自动刷新一次后重试
- 路由结构 `/workspaces/:wsId/...`；❌ **禁止**组件里硬编码 `workspace_id`，只能从路由参数或 store 取
- 后端返回 403 时必须展示权限提示，不得静默重试

---

## 4. 契约层约束（packages/contracts）

```bash
pnpm contracts:generate   # 后端 → GET /openapi.json → openapi.yaml
pnpm contracts:build      # yaml → src/generated/index.ts
pnpm contracts:check      # CI 漂移检测
pnpm contracts:compat     # 破坏性变更检测
```

**禁令：**
- ❌ 手写 `packages/contracts/src/generated/`（每次 build 会覆盖）
- ❌ 手写前端 API interface（`import type { Xxx } from '@agenza/contracts'`）
- ❌ 后端手写 `openapi.yaml`（Pydantic schema 为真源）
- 新增 `/api/v1/*` 路由后必须重新生成契约，否则前端类型缺失

---

## 5. 技术栈锁定

| 层 | 选型 | 说明 |
|---|---|---|
| Monorepo | pnpm workspace + Turborepo | JS 侧 workspace；Python 侧 uv 独立 |
| 前端 | Vite 5 + React 18 + TS + React Router v6 + Zustand + @xyflow/react + Ant Design 5 | |
| 后端 | Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.0 | uv 管理，Ruff 检查 |
| 数据库 | **PostgreSQL**（自托管生产）；SQLite（本地开发） | 通过 `DATABASE_URL` 切换 |
| 鉴权 | JWT（python-jose）+ bcrypt（passlib） | access + refresh |
| 异步 | Redis + Celery（可选，多实例时启用） | 单实例默认进程内执行 |
| 部署 | Docker + docker-compose | 已提供根目录 `Dockerfile` / `docker-compose.yml` |
| 桌面壳 | Electron（仅 Community） | contextIsolation=true、nodeIntegration=false、sandbox=true |
| 代码规范 | 前端 ESLint + Prettier，后端 Ruff | 根目录 .editorconfig 统一 |

---

## 6. 新增 feature 验证清单

### 后端
- [ ] 在 `apps/api/src/app/modules/<feature>/` 建标准六件套（含 `dependencies.py` 按需）
- [ ] 模型带 `workspace_id` + 审计字段，Repository 全部查询带 workspace 过滤
- [ ] 在 `main.py` 注册 router，新路由用 `/api/v1` 前缀
- [ ] 写 alembic 迁移（`alembic revision --autogenerate`），并在 PostgreSQL 上实跑一次
- [ ] 跑 `pnpm contracts:generate && pnpm contracts:check`

### 前端
- [ ] 在 `apps/web/src/features/<feature>/` 建目录：`api/`、`components/`、`hooks/`、`types.ts`、`index.tsx`
- [ ] 在 `apps/web/src/router/index.tsx` 注册路由（多用户页面挂在 `/workspaces/:wsId/...` 下）
- [ ] 所有 API 类型从 `@agenza/contracts` 导入
- [ ] 需要登录/权限的页面接入 `AuthGuard` 与角色校验

### 禁止
- [ ] ❌ 在 `modules/` 下建 `routers/` 或 `services/` 平铺目录
- [ ] ❌ 把业务组件放进 `shared/components/`
- [ ] ❌ 手写 API interface
- [ ] ❌ feature 间直接 import
- [ ] ❌ 查询不带 `workspace_id` 过滤

---

## 7. 启动命令

```bash
# 开发模式
pnpm dev          # 后端 127.0.0.1:8000 + 前端 localhost:5174
pnpm dev:api
pnpm dev:web

# 多用户模式（本地验证）
# 在 apps/api/.env 设置：TENANCY_ENABLED=true、JWT_SECRET=<随机值>、DATABASE_URL=<pg url>

# 契约层
pnpm contracts:generate / build / check / compat

# 质量门禁
pnpm check        # lint + ruff + 类型 + pytest + 前端单测 + 契约漂移 + 兼容性
pnpm build

# 自托管部署（PostgreSQL + 单容器）
cp deploy/.env.example .env   # 修改 POSTGRES_PASSWORD / JWT_SECRET
docker compose up -d --build
```

---

## 8. 禁止变更清单

以下内容**不得随意修改**，修改前必须在 commit message 中注明原因并做影响评估：

- `packages/contracts/` 的生成/校验脚本链
- `apps/api/src/app/core/`（横切入口：config / tenancy / engine / providers / security）
- 多租户隔离规则与 `workspace_id` 过滤策略
- `Electron preload.js` 的 contextBridge 白名单（安全边界）
- `AGENTS.md` 本身
- `.editorconfig`、Ruff / ESLint / Prettier 配置

---

**最后提醒：写代码前先想"这个文件应该放哪里、这条查询属于哪个 workspace"。两个答案都不确定时，回到第 2、3、4 节对照。**
