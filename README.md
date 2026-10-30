# AgentFlow

本地单用户的 AI 工作流编排平台：在画布上拖拽节点、连线、逐节点调试，运行过程与每一步的输入/输出/耗时/token 都可见。

- 前端：React 18 + Vite 5 + TypeScript + Ant Design 5 + @xyflow/react
- 后端：FastAPI + Pydantic v2 + SQLAlchemy 2.0 + SQLite（WAL），执行引擎是自研 DAG
- 契约：后端 Pydantic → OpenAPI → 前端 TypeScript 类型（单一事实源）

> 目录结构、分层禁令与安全基线见 [`AGENTS.md`](AGENTS.md)；开发阶段与下一步计划见 [`docs/agentflow-roadmap.md`](docs/agentflow-roadmap.md)。

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
pnpm check            # lint + ruff + format 检查 + 类型检查 + pytest + 契约漂移

# 分开跑
pnpm test             # 后端 pytest
pnpm lint             # 前端 ESLint
pnpm lint:api         # 后端 Ruff
pnpm typecheck        # 前端 tsc -b
pnpm format:check     # 前后端格式检查
pnpm build            # 前端生产构建

# 契约（改了后端 schemas 或路由 docstring 之后必须跑）
pnpm contracts:generate   # 启动后端 → 导出 openapi.yaml
pnpm contracts:build      # yaml → src/generated/index.ts
pnpm contracts:check      # CI 用的漂移检测
```

> 注意：路由 **docstring 也算契约**（会写进 OpenAPI 的 description），改了它同样要重新生成。

## 数据与配置

- 默认数据目录 `<repo>/data/`：SQLite 库 `agentflow.db` 与 Fernet 主密钥 `.secret.key` 都在这里
- 可用环境变量 `DATA_DIR` 覆盖（打包时由 Electron 指定用户数据目录）
- 后端配置项见 [`apps/api/.env.example`](apps/api/.env.example)；前端 API 地址可用 `VITE_API_BASE_URL` 覆盖
- 数据库结构由 alembic 管理：从 `alembic/versions/0001_baseline.py` 起，启动时自动 `upgrade head`；
  历史库（无 `alembic_version`）会被自动打标，不重建、不动数据

## 目录速览

```
apps/api/src/app/
├── core/          # 横切：config / security / logger / engine / providers
├── db/            # engine + session + 迁移入口
└── modules/       # 按 feature 组织：workflows / runs / providers / settings
apps/web/src/
├── features/      # 每个功能自己的 components / hooks / api / types / index.tsx
├── shared/        # 跨 feature 的 UI、hooks、http 封装
└── router/        # 路由表
packages/contracts/  # OpenAPI 与生成的 TS 类型（禁止手写 generated/）
```

## 测试

```bash
pnpm test                                                       # 全部后端用例
uv run --directory apps/api pytest tests/test_run_e2e.py -v      # 单文件
```

测试使用临时数据目录，不会写入仓库的 `data/`。少数用例标记 `xfail`，它们编码的是
**已知缺陷的目标行为**（修复后会 XPASS 报错，提醒删除标记）。

## 文档

| 文件 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 协作硬约束（目录、分层、契约、安全），优先级最高 |
| [`docs/agentflow-roadmap.md`](docs/agentflow-roadmap.md) | 阶段进度、下一步计划、待决策项 |
| [`docs/code-review-2026-10-30.md`](docs/code-review-2026-10-30.md) | 代码评审报告与缺陷处置进度 |
| [`docs/dev-environment.md`](docs/dev-environment.md) | 本机环境布局与常见坑 |
| `docs/agentflow-prd.html`、`docs/agentflow-design.html`、`docs/ui-design/index.html` | 需求 / 技术设计 / 视觉规范 |
