# AgentFlow

[![CI](https://github.com/polarisz1/AgentFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/polarisz1/AgentFlow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

可视化 AI 工作流编排平台：在画布上拖拽节点、连线、逐节点调试，运行过程与每一步的输入 / 输出 / 耗时 / Token 都可见。支持子工作流复用、Webhook / API Key 触发、多工作空间与审计。

> **项目定位**：个人维护的开源、自托管项目。商业化 SaaS 目标已暂停，代码中的多租户能力保留，可作为自托管多用户或单用户部署使用。

- 前端：React 18 + Vite 5 + TypeScript + Ant Design 5 + @xyflow/react
- 后端：FastAPI + Pydantic v2 + SQLAlchemy 2.0 + PostgreSQL（本地开发可切 SQLite）
- 引擎：自研 DAG 调度，支持并发、条件分支、重试、超时、取消、Token 统计与子工作流
- 契约：后端 Pydantic → OpenAPI → 前端 TypeScript 类型（单一事实源）
- 许可证：[MIT](LICENSE)

## 功能

- **可视化编排**：输入、LLM、结构化提取、HTTP、Python 脚本、条件、合并、子工作流、输出
- **可观测运行**：节点时间线、输入 / 输出快照、耗时、Token、SSE 实时事件、运行诊断
- **版本与发布**：工作流草稿 / 版本快照 / 发布；子工作流只读取已发布版本，结果可复现
- **子工作流**：把已发布工作流作为节点复用；独立子运行，可单独查看节点、诊断与成本
- **模型接入**：OpenAI 兼容、Ollama、Anthropic 兼容；Provider 密钥加密存储
- **AI Gateway**：模型路由与 Token 预算（按工作空间配置）
- **触发方式**：手动 / 调试 / HTTP（`X-API-Key`）/ Webhook（HMAC-SHA256 签名）
- **协作与安全**：JWT + bcrypt、工作空间隔离、成员角色、审计日志、API Key 仅存哈希
- **界面**：中文 UI、暗色主题、模板与命令面板

## 快速部署（Docker Compose）

前置：Docker 24+ 与 Docker Compose v2。

```bash
git clone https://github.com/polarisz1/AgentFlow.git
cd AgentFlow

cp deploy/.env.example .env
# 编辑 .env：至少修改 POSTGRES_PASSWORD 与 JWT_SECRET
# JWT_SECRET 可用：openssl rand -hex 32

docker compose up -d --build
```

打开 <http://localhost:8000>：

1. **首个注册用户会创建默认工作空间并成为 owner**；
2. 之后 `ALLOW_REGISTRATION=false` 会关闭公开注册；
3. 在「模型配置」中添加服务商（OpenAI 兼容 / Ollama / Anthropic 兼容），否则 LLM 节点会提示未配置。

常用命令：

```bash
docker compose logs -f app     # 查看日志
docker compose restart app     # 重启应用
docker compose down            # 停止（保留数据卷）
docker compose down -v         # 停止并删除数据（谨慎）
```

数据持久化：PostgreSQL 在 `agentflow-pgdata` 卷，应用密钥 / 导出文件在 `agentflow-data` 卷（容器内 `/data`）。

> 单容器内后端直接托管前端产物，并默认使用**进程内执行**，适合个人 / 小团队单实例部署。
> 多实例水平扩展需要 Redis + Celery 与共享存储，目前尚未作为默认部署路径验证。

### 反向代理与 HTTPS

对外网开放时建议在 Compose 前加一层 Caddy / Nginx，并只暴露 443：

```caddyfile
agentflow.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

同时把 `CORS_ORIGINS` 保持为 `[]`（同源访问不需要放行跨域），并设置强随机 `JWT_SECRET`。

## 本地开发

环境要求：Node.js ≥ 20、pnpm 9.12、Python 3.12、uv。

```bash
pnpm install
uv sync --directory apps/api --all-extras

# 同时启动后端 127.0.0.1:8000 与前端 localhost:5174
pnpm dev
```

只启动一半：`pnpm dev:api` / `pnpm dev:web`。端口被占用时换端口：

```bash
node tools/scripts/dev.mjs --api-port 8010 --web-port 5180
```

## 配置

后端配置见 [`apps/api/.env.example`](apps/api/.env.example)，常用项：

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | 留空使用 `data/agentflow.db`（SQLite）；生产建议 PostgreSQL |
| `DATA_DIR` | 数据目录（SQLite、`.secret.key`、导出文件） |
| `TENANCY_ENABLED` | `true` 启用登录与工作空间隔离；`false` 为单用户兼容模式 |
| `ALLOW_REGISTRATION` | 首个用户之后是否允许继续注册（公网自托管建议 `false`） |
| `JWT_SECRET` | JWT 签名密钥；多用户模式必须显式设置 |
| `CORS_ORIGINS` | 跨域白名单；同源部署留 `[]` |
| `ENGINE_MAX_CONCURRENCY` | 工作流节点并发上限 |
| `DEFAULT_TIMEOUT` | 节点默认超时（秒） |
| `CELERY_BROKER_URL` | 可选；配置 Redis 后任务投递到 Celery worker |

前端 API 地址由 `VITE_API_BASE_URL` 决定；生产构建默认使用相对路径 `/api`，由同一个后端托管。

## 常用命令

```bash
pnpm check            # lint + ruff + 格式 + 类型 + pytest + 前端单测 + 契约漂移/兼容性
pnpm test             # 后端 pytest
pnpm test:web         # 前端 vitest
pnpm typecheck        # 前端 tsc
pnpm lint             # 前端 ESLint
pnpm lint:api         # 后端 Ruff
pnpm build            # 前端生产构建
pnpm e2e              # Playwright 浏览器走查

pnpm contracts:generate   # 后端 → openapi.yaml
pnpm contracts:build      # openapi.yaml → 前端类型
pnpm contracts:check      # 契约漂移检测
pnpm contracts:compat     # 破坏性变更检测
```

## 目录结构

```
AgentFlow/
├── apps/
│   ├── web/              # React 前端（features/<feature>/）
│   └── api/              # FastAPI 后端（modules/<feature>/）
├── packages/contracts/   # OpenAPI 与生成的 TypeScript 类型
├── deploy/               # Docker Compose 环境变量示例
├── docs/                 # 工程记录与历史设计
├── electron/             # 旧桌面壳（保留，不再演进）
├── Dockerfile
└── docker-compose.yml
```

分层与编码约束见 [`AGENTS.md`](AGENTS.md)。

## 测试与质量

- 后端：pytest（含运行链路、租户隔离、Webhook、子工作流、迁移）
- 前端：vitest（编辑器语义、运行层级、契约类型）
- E2E：Playwright（含 100 节点性能基线）
- CI：GitHub Actions（契约、后端、前端、E2E、依赖审计）

## 路线图 / 已知缺口

开源自托管优先，以下能力尚未完成或需要生产化验证：

- **账号体系**：邮箱验证、邀请成员、找回密码、OIDC / SSO（当前仅邮箱密码 + 首用户初始化）
- **权限**：更细粒度 RBAC（当前 owner / editor / viewer），以及团队级资源配额
- **部署**：多实例水平扩展（Celery + Redis）、对象存储、备份 / 恢复脚本、HTTPS 一键示例
- **运维**：指标 / 链路追踪、告警、审计导出、限流与滥用防护
- **产品**：国际化、节点插件 SDK、模板市场、更多内置节点
- **测试**：真实模型 Provider 的定期集成测试、长时间运行稳定性测试

## 文档

| 文件 | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | 协作硬约束（目录、分层、工作空间隔离、契约、安全） |
| [`docs/dev-environment.md`](docs/dev-environment.md) | 本机环境与常见问题 |
| [`docs/v0.1-perf-baseline.md`](docs/v0.1-perf-baseline.md) | 100 节点性能基线 |
| [`docs/dependency-audit-2026-11-01.md`](docs/dependency-audit-2026-11-01.md) | 依赖漏洞与许可证审计 |
| [`docs/v0.2-provider-matrix.md`](docs/v0.2-provider-matrix.md) | Provider 验收矩阵 |
| [`docs/saas-strategy-2026-11-03.md`](docs/saas-strategy-2026-11-03.md) | 历史：商业化战略（已暂停，仅作设计参考） |
| [`docs/saas-product-design-2026-11-03.md`](docs/saas-product-design-2026-11-03.md) | 历史：SaaS 产品设计（已暂停） |
| [`docs/saas-backlog-2026-11-03.md`](docs/saas-backlog-2026-11-03.md) | 历史：Sprint 执行清单（已归档） |

## 许可证

[MIT](LICENSE) · Copyright (c) 2026 polarisz1

如果希望加入专利授权条款，可改用 Apache-2.0；MIT 更适合希望被广泛采用和二次分发的个人项目。
