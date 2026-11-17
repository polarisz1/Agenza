# Agenza

[![CI](https://github.com/polarisz1/Agenza/actions/workflows/ci.yml/badge.svg)](https://github.com/polarisz1/Agenza/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Agenza 是一个自托管的 AI 工作流编排平台。你把 LLM、HTTP、Python 脚本、条件分支这些节点用 DAG 串起来，Agenza 负责调度执行，并把每一步的输入、输出、耗时、Token、失败原因完整地呈现出来。

不同于聊天机器人搭建工具，Agenza 的核心设计是「过程可观测」——节点级输入快照、变量解析结果、运行对比 diff、规则驱动的失败根因分类——让你在工作流跑挂的时候不用盯着一堆日志猜。

> 商业 SaaS 目标已暂停，当前按个人开源自托管项目维护。多用户 / 多工作空间能力保留为可选部署模式。

---

## 核心能力

- **可视化 DAG 编辑器**：基于 @xyflow/react，节点拖拽、连线、属性面板配置；节点类型通过注册表扩展，新增类型只需注册组件与配置项。
- **自研 DAG 执行引擎**：Kahn 拓扑分层调度 + 信号量并发闸门；节点级超时、指数退避重试、取消传播；上游失败标记 skipped 而非整体停摆。
- **9 类节点**：输入 / LLM / 结构化抽取 / HTTP / Python 脚本 / 条件分支 / 合并 / 子工作流 / 输出。Python 脚本在独立子进程中执行，有路径白名单。
- **子工作流复用**：子工作流作为独立 Run 落库，父子通过 `parent_run_id` 关联；调用链栈拦截跨运行递归（最大深度 5）；同一子流程允许并发调用。
- **运行可观测性**：SSE 增量推送节点状态；运行详情四 Tab（概览 / 节点 / 成本 / 诊断）；规则驱动的失败根因分类（12 类常见错误），可选 AI 深度分析带脱敏和缓存。
- **AI Gateway**：模型路由策略、预算告警、硬停机、按月用量统计；执行器不直接依赖厂商 SDK，统一经 Provider 层调用。
- **触发器**：API Key（只存哈希，明文仅创建时返回一次）+ HTTP 触发；工作流级 Webhook（HMAC-SHA256 验签、时间窗 ±5 分钟、JSONPath 输入映射、幂等）。只允许触发已发布版本。
- **多工作空间隔离**：JWT + owner/editor/viewer 角色；租户上下文只来自服务端解出的 token，Repository 显式过滤 + SQLAlchemy ORM 自动注入构成双保险；Celery worker 显式传递租户上下文。
- **契约驱动**：Pydantic v2 为唯一事实源 → 导出 OpenAPI → 生成前端 TypeScript 类型，CI 校验契约漂移与破坏性变更。
- **诊断与复盘**：跨运行趋势按工作流聚合，给出同类失败 Top N、每日成功率、空输出率；重跑整个 Run 或单独重跑某节点。

---

## 快速开始（Docker Compose）

前置条件：Docker 20.10+。

```bash
cp deploy/.env.example .env
# 编辑 .env：至少改 POSTGRES_PASSWORD 和 JWT_SECRET
docker compose up -d --build
```

启动后访问 `http://localhost:8000`，首个注册的用户会自动创建默认工作空间并成为 owner。之后是否开放注册由 `ALLOW_REGISTRATION` 控制（默认 `false`）。

数据持久化：PostgreSQL 在 `agenza-pgdata` 卷，应用主密钥与 SQLite 回退库在 `agenza-data` 卷（容器内 `/data`）。

### 配置速查

| 变量 | 说明 | 默认 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串；留空则使用 SQLite `data/agenza.db` | 空 |
| `JWT_SECRET` | JWT 签名密钥，生产必须显式配置 | 空（桌面模式自动生成） |
| `ALLOW_REGISTRATION` | 是否开放注册（首个用户始终允许） | `false` |
| `TENANCY_ENABLED` | 是否启用多租户模式（多工作空间隔离） | `true`（compose） |
| `CORS_ORIGINS` | 跨域来源数组；生产建议空数组 `[]` 做同源部署 | `["http://localhost:5174"]` |
| `ENGINE_MAX_CONCURRENCY` | 节点并发上限 | `4` |
| `DEFAULT_TIMEOUT` | 节点级超时秒数 | `120` |
| `RUN_RETENTION` | 每工作流保留的运行记录条数 | `200` |

---

## 架构

```
┌────────────────────────────────── apps/web ──────────────────────────────────┐
│  @xyflow/react 画布  │  Zustand 状态  │  Ant Design UI  │  SSE 实时事件       │
└────────────────────────────────────────┬─────────────────────────────────────┘
                                         │ 类型来自 @agenza/contracts
┌────────────────────────────────────────▼─────────────────────────────────────┐
│                            FastAPI（apps/api）                                │
│  modules/<feature>/  router → service → repository → models                  │
│  core/engine/        Kahn 调度器  │  执行器注册表  │  SSE 事件总线  │  变量解析  │
│  core/providers/     模型适配 + ModelRouter；执行器不直接依赖厂商 SDK          │
│  core/tenancy.py     ContextVar 租户上下文 + ORM 自动 workspace 过滤           │
└────────────┬──────────────────────┬──────────────────────┬───────────────────┘
             │                      │                      │
     PostgreSQL                 Celery + Redis           SQLite
    （自托管生产）            （可选，多实例）         （本地开发/桌面）
```

三层设计原则：

1. **边界写进目录**。前端按 feature 切，`shared` 不反向依赖 feature；后端禁止跨模块直接 import 对方 repository，只能走 service。目录结构不是口头约定，见 [AGENTS.md](AGENTS.md)。
2. **引擎与业务解耦**。调度器只认 `NodeContext` 和 `NodeResult`，节点执行器注册在注册表里。加一种节点不改调度核心。
3. **契约先行**。Pydantic 模型 → OpenAPI → TS 类型，前端不手写 interface，后端不手写 openapi.yaml。

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | React 18 · TypeScript · Vite 5 · @xyflow/react · Zustand · Ant Design 5 · ECharts | Vite 冷启动快，Zustand 细粒度订阅避免画布高频更新的全量重渲染 |
| 后端 | Python 3.12 · FastAPI · Pydantic v2 · SQLAlchemy 2.0 · Alembic | Pydantic v2 作为契约唯一事实源；Alembic 显式迁移，禁止 `create_all` 兜底 |
| 数据库 | PostgreSQL（生产）· SQLite（本地） | PostgreSQL 支持 UUID / JSONB / 部分索引；SQLite 让本地零配置启动 |
| 异步 | Celery + Redis（可选） | 单实例进程内执行，多实例才启用，不让自托管的人先装中间件 |
| 实时 | SSE | 单向推送够用，鉴权和代理比 WebSocket 简单 |
| 鉴权 | JWT（access + refresh）· bcrypt · Fernet | 无状态便于水平扩展；密钥加密入库，明文仅创建时返回 |
| 构建 | pnpm workspace + Turborepo + uv | monorepo 三包分离；uv 比 pip 快且锁文件确定 |
| 部署 | 多阶段 Dockerfile · Docker Compose | 前端产物由 FastAPI 托管，单容器 + PostgreSQL 即可 |

---

## 目录结构

```
Agenza/
├── apps/
│   ├── web/            # React 前端 → src/features/<feature>/
│   └── api/            # FastAPI 后端 → src/app/modules/<feature>/
├── packages/contracts/ # OpenAPI 契约 → 单一事实源
├── deploy/             # Docker Compose 环境变量示例
├── tools/scripts/      # 辅助脚本
├── docs/               # 规划与工程记录（含已归档的 SaaS 文档）
├── Dockerfile
├── docker-compose.yml
└── AGENTS.md           # 开发约束（新贡献者必读）
```

---

## 本地开发

### 依赖

- Node.js ≥ 20
- Python ≥ 3.12 + [uv](https://docs.astral.sh/uv/)

### 启动

```bash
# 前端 + 后端同时开发
pnpm dev

# 或分别启动
pnpm dev:web          # Vite → http://localhost:5174
uv run --directory apps/api python -m app.run  # FastAPI → http://localhost:8000
```

默认 SQLite，数据落在 `data/agenza.db` 和 `data/.secret.key`。

### 常用命令

```bash
pnpm check            # lint + format + typecheck + pytest + 前端单测 + 契约校验
pnpm build            # 前端 + 后端镜像构建验证
pnpm contracts:generate    # 起后端抓 OpenAPI → yaml
pnpm contracts:build       # yaml → TS 类型
pnpm contracts:check       # CI 漂移检测
pnpm contracts:compat      # 破坏性变更检测
```

---

## 已知缺口

- **没有分布式执行**：多实例下没有任务去重与分布式锁，Celery 取消也是尽力而为。
- **工作空间切换未完成**：登录固定取第一个工作空间，前端路由预留了 `/workspaces/:wsId`，后端没有换票接口。
- **前端大图未优化**：节点数上千会卡，没有虚拟化。
- **没有 CI 镜像发布**：Dockerfile 与 compose 已就绪，但没配 GHCR 推送。
- **测试偏单元和集成**：没有 Playwright E2E 进 PR 级 CI（本地可以跑 `pnpm e2e`）。
- **Docker 未做完整构建验证**：只跑过 `docker compose config` 校验，还没实际 `up --build`。

下一步优先级：补工作空间切换 → 镜像 CI → E2E，分布式执行排最后。

---

## License

MIT © polarisz1
