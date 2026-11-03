# AgentFlow

多租户 AI 工作流编排 SaaS：在画布上拖拽节点、连线、逐节点调试，运行过程与每一步的输入/输出/耗时/token 都可见；支持团队协作、工作空间隔离，可选私有化部署。

- 前端：React 18 + Vite 5 + TypeScript + Ant Design 5 + @xyflow/react
- 后端：FastAPI + Pydantic v2 + SQLAlchemy 2.0 + PostgreSQL（本地开发可切 SQLite），执行引擎是自研 DAG
- 鉴权与租户：JWT + bcrypt + `TenantMiddleware`（`TENANCY_ENABLED` 开关，桌面单用户模式自动降级）
- 契约：后端 Pydantic → OpenAPI → 前端 TypeScript 类型（单一事实源）

> 目录结构、分层禁令、多租户与安全基线见 [`AGENTS.md`](AGENTS.md)；SaaS 战略、产品设计与执行计划见下方文档表。

## 环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | 前端与契约脚本 |
| pnpm | 9.12 | 仓库声明的 packageManager |
| Python | 3.12 | 由 uv 管理，不需要手动装 |
| uv | 最新 | 后端依赖与虚拟环境 |

## 快速开始

```bash
# 1) 安装依赖（JS 侧与 Python 侧各一次）
pnpm install
uv sync --directory apps/api --all-extras

# 2) 一条命令同时起后端与前端（Ctrl+C 一起停）
pnpm dev
```

`pnpm dev` 会并行启动：

- 后端 <http://127.0.0.1:8000>（只监听 `src/app` 变化，自动重载）
- 前端 <http://localhost:5173>（HMR，`/api` 代理到上面的后端）

端口被占用时会**直接报错退出**（前端开了 `--strictPort`，不会悄悄换号），换端口的方式：

```bash
node tools/scripts/dev.mjs --api-port 8010 --web-port 5180
```

> - 只想起一半：`pnpm dev:api` / `pnpm dev:web`
> - `bash tools/scripts/dev.sh [api-port] [web-port]` 是兼容入口，内部转调同一个脚本；
>   它要求**该 bash 里有 node**（注意 Windows 的 `bash.exe` 可能是 WSL，里面通常没有 node，
>   此时脚本会提示改用 `pnpm dev`）

打开前端地址 → 「工作流」→「新建」。首次使用先在「模型配置」里添加服务商
（OpenAI 兼容 / Ollama / Anthropic 兼容），否则 LLM 节点会提示"服务商未配置"。

## 常用命令

```bash
# 质量门禁（提交前跑这一个就够）
pnpm check            # lint + ruff + format + 类型检查 + pytest + 前端单测 + 契约漂移 + 契约兼容性

# 分开跑
pnpm test             # 后端 pytest
pnpm test:web         # 前端 vitest
pnpm lint             # 前端 ESLint
pnpm lint:api         # 后端 Ruff
pnpm typecheck        # 前端 tsc -b
pnpm format:check     # 前后端格式检查
pnpm build            # 前端生产构建
pnpm e2e              # Playwright 浏览器走查（含 100 节点性能基线）

# 契约（改了后端 schemas 或路由 docstring 之后必须跑）
pnpm contracts:generate   # 启动后端 → 导出 openapi.yaml
pnpm contracts:build      # yaml → src/generated/index.ts
pnpm contracts:check      # 漂移检测（提交内容 vs 后端当前输出）
pnpm contracts:compat     # 破坏性变更检测（当前 vs 发版基线）
pnpm contracts:baseline   # 发版时把当前契约快照为新基线

# 依赖审计（CI 每周也会跑）
pnpm audit:js             # pnpm audit --prod（high/critical 才失败）
pnpm audit:py             # uv export → pip-audit
```

> 注意：路由 **docstring 也算契约**（会写进 OpenAPI 的 description），改了它同样要重新生成。

## 数据与配置

- 数据库由 `DATABASE_URL` 决定：SaaS / 私有化用 PostgreSQL，本地开发默认 `<repo>/data/agentflow.db`（SQLite WAL）
- 多租户模式开关 `TENANCY_ENABLED`（默认 false，即桌面单用户模式）
- Fernet 主密钥 `.secret.key` 在数据目录；JWT 密钥由 `JWT_SECRET` 注入，桌面模式自动生成
- 可用环境变量 `DATA_DIR` 覆盖数据目录；后端配置见 [`apps/api/.env.example`](apps/api/.env.example)，前端 API 地址可用 `VITE_API_BASE_URL` 覆盖
- 数据库结构由 alembic 管理：所有变更走迁移脚本，启动时自动 `upgrade head`

## 目录速览

```
apps/api/src/app/
├── core/          # 横切：config / tenancy / security / logger / engine / providers
├── db/            # engine + session + 迁移入口
└── modules/       # 按 feature 组织：auth / workspaces / workflows / runs / providers / settings
apps/web/src/
├── features/      # 每个功能自己的 components / hooks / api / types / index.tsx
├── shared/        # 跨 feature 的 UI、hooks、http 封装
└── router/        # 路由表
packages/contracts/  # OpenAPI 与生成的 TS 类型（禁止手写 generated/）
deploy/              # Docker / compose / nginx（Sprint 5）
```

## 测试

```bash
pnpm test                                                       # 全部后端用例
uv run --directory apps/api pytest tests/test_run_e2e.py -v      # 单文件
pnpm test:web                                                   # 前端 store/语义单测
pnpm e2e                                                        # 浏览器走查 + 性能基线
```

测试使用临时数据目录，不会写入仓库的 `data/`。性能基线见
[`docs/v0.1-perf-baseline.md`](docs/v0.1-perf-baseline.md)（100 节点拖拽 ≥30fps 是 CI 闸门）。

## 文档

| 文件 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 协作硬约束（目录、分层、多租户、契约、安全），优先级最高 |
| [`docs/saas-strategy-2026-11-03.md`](docs/saas-strategy-2026-11-03.md) | SaaS 商业化战略：市场、JTBD、定位、RICE、路线图 |
| [`docs/saas-product-design-2026-11-03.md`](docs/saas-product-design-2026-11-03.md) | SaaS 产品与功能设计：多租户、AI Gateway、信息架构 |
| [`docs/saas-backlog-2026-11-03.md`](docs/saas-backlog-2026-11-03.md) | Sprint 1–5 执行清单与关键路径 |
| [`docs/dev-environment.md`](docs/dev-environment.md) | 本机环境布局与常见坑 |
| [`docs/v0.1-perf-baseline.md`](docs/v0.1-perf-baseline.md) | 100 节点性能基线与阈值（CI 闸门） |
| [`docs/dependency-audit-2026-11-01.md`](docs/dependency-audit-2026-11-01.md) | 依赖漏洞与许可证审计 |
| [`docs/v0.2-provider-matrix.md`](docs/v0.2-provider-matrix.md) | 真实 Provider 验收矩阵（AI Gateway 联调用） |
| [`docs/code-review-2026-10-30.md`](docs/code-review-2026-10-30.md) | 首轮代码评审与缺陷处置进度（历史证据） |
| [`docs/code-review-2026-11-01.md`](docs/code-review-2026-11-01.md) | v0.1 收尾复核与验证矩阵（历史证据） |
