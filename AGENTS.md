# AGENTS.md · AgentFlow

> **本文件是 AI 协作时的最高优先级约定。修改前请先阅读并遵守以下约束。**
> 违反任何硬性约束视为错误提交，必须在首次 commit 前修复。

---

## 1. 目录结构（硬性约束）

```
AgentFlow/
├── apps/
│   ├── web/          # React 前端 → apps/web/src/features/<feature>/
│   └── api/          # FastAPI 后端 → apps/api/src/app/modules/<feature>/
├── packages/contracts/  # OpenAPI 契约 → 单一事实源
├── electron/         # Electron 桌面壳（Phase 1+ 启用）
├── pyinstaller/      # PyInstaller 后端打包脚本
└── tools/scripts/    # 辅助脚本
```

---

## 2. Python 后端（apps/api）约束

### 2.1 模块组织（**禁止违反**）

```
apps/api/src/app/modules/<feature>/
├── __init__.py
├── router.py         # 本 feature 的全部 FastAPI 路由
├── service.py        # 业务逻辑编排
├── repository.py      # SQLAlchemy ORM 查询
├── schemas.py        # Pydantic v2 schema（OpenAPI 单一事实源）
└── models.py         # SQLAlchemy 模型
```

**禁令：**
- ❌ **禁止**在 `modules/` 下建 `routers/`、`services/`、`repositories/` 平铺目录
- ❌ **禁止**跨 feature 直接 import 对方的 `repository.py`（只能通过 `service.py` 抽象）
- ✅ 横切关注点（DB session、配置、日志、执行引擎、服务商适配）统一放 `src/app/core/`

### 2.2 执行引擎

引擎代码在 `src/app/core/engine/`，包含：
- `manager.py` — RunManager（运行注册表、取消、并发闸门）
- `scheduler.py` — Kahn 拓扑分层调度
- `registry.py` — NodeExecutor 注册表
- `contexts.py` — NodeContext + NodeResult 数据结构
- `event_bus.py` — 内存事件总线 → SSE
- `variable.py` — 变量解析器 `{{ source.field }}`
- `validators.py` — 图校验器
- `executors/` — 七类节点执行器

### 2.3 服务商适配

引擎不直接调模型，统一走 `src/app/core/providers/` 适配层：
- `openai_compat.py` — OpenAI 兼容接口（gpt-4o、gpt-4o-mini 等）
- `ollama.py` — 本地 Ollama（`localhost:11434`）
- `anthropic_compat.py` — Anthropic 兼容接口
- `base.py` — Provider 抽象基类，定义 `chat() → ChatResult` 契约

---

## 3. React 前端（apps/web）约束

### 3.1 功能模块组织（**禁止违反**）

```
apps/web/src/features/<feature>/
├── components/       # 仅本 feature 使用的组件
├── hooks/            # 仅本 feature 使用的 hooks
├── api/              # 本 feature 的 API 调用（从 @agentflow/contracts 导入类型）
├── types.ts          # 本 feature 内部类型（不对外暴露）
└── index.tsx         # 入口，导出 Route 对象
```

**禁令：**
- ❌ **禁止**把业务组件放进 `src/shared/`（shared 只放跨 feature 的通用 UI、hooks、工具）
- ❌ **禁止** feature 之间直接 import 对方的 `api/` 或 `components/`
- ❌ **禁止** 手写 API 类型（全部从 `@agentflow/contracts` 导入）

### 3.2 Shared 边界

```
apps/web/src/shared/
├── components/       # 跨 feature 通用 UI（AppLayout、Sidebar、StatusBadge）
├── hooks/            # 跨 feature 通用 hooks（useDebounce、useEventSource）
├── utils/            # 通用工具（request.ts 封装、formatters）
└── lib/              # 第三方库包装（axios 实例、dayjs 配置）
```

**禁令：**
- ❌ **禁止** `shared/` 反向依赖 `features/` 下任何代码
- ❌ **禁止** 在 `shared/` 中包含业务感知逻辑

---

## 4. 契约层约束（packages/contracts）

### 4.1 工作流

```bash
# 1. 后端 Pydantic schema 修改后，重新导出 OpenAPI
pnpm contracts:generate    # 启动 apps/api → GET /openapi.json → 写入 openapi.yaml

# 2. 从 YAML 生成前端 TS 类型
pnpm contracts:build       # openapi-typescript → src/generated/index.ts

# 3. CI 校验（任何漂移都阻断合并）
pnpm contracts:check       # diff 导出结果 vs 已提交的 openapi.yaml
```

**禁令：**
- ❌ **禁止** 手写 `packages/contracts/src/generated/` 目录（每次 `contracts:build` 会覆盖）
- ❌ **禁止** 手写前端 API interface（直接 `import type { Xxx } from '@agentflow/contracts'`）
- ❌ **禁止** 后端手写 openapi.yaml（由 FastAPI 自动导出，Pydantic schema 为真源）

### 4.2 单一事实源链路

```
apps/api/src/app/modules/*/schemas.py (Pydantic v2)
    → FastAPI 自动导出 /openapi.json
    → packages/contracts/openapi.yaml (缓存副本)
    → openapi-typescript 生成
    → packages/contracts/src/generated/index.ts
    → apps/web/src/features/*/api/*.ts (import type from @agentflow/contracts)
```

---

## 5. 技术栈锁定

| 层 | 选型 | 说明 |
|---|---|---|
| Monorepo | pnpm workspace + Turborepo | JS 侧 workspace；Python 侧 uv 独立 |
| 前端 | Vite 5 + React 18 + TypeScript | 路由：React Router v6；状态：Zustand；画布：@xyflow/react；UI：Ant Design 5 |
| 后端 | Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.0 | 依赖管理：uv；格式检查：Ruff |
| 数据库 | SQLite（WAL 模式） | 零配置；生产可切 PostgreSQL |
| 桌面壳 | Electron + electron-updater | preload contextBridge 白名单；contextIsolation/nodeIntegration=false |
| 后端打包 | PyInstaller 单文件 exe | 运行时资源：前端 dist + preload + main.js |
| 前端打包 | Vite build | 产物打包进 asar resources |
| 代码规范 | 前端 ESLint + Prettier，后端 Ruff | 根目录 .editorconfig 统一 |

---

## 6. 安全基线

1. Electron 壳必须启用 `contextIsolation=true` + `nodeIntegration=false` + `sandbox=true`
2. 后端密钥用 Fernet 加密，明文永不入库；主密钥在用户数据目录生成
3. Python 脚本节点用独立子进程（`python -I -S`），工作目录为临时目录
4. SQLite 单写锁 + WAL；FastAPI 默认只监听 `127.0.0.1`
5. 路径穿越校验：所有文件操作走 `Path.resolve()` + 白名单根目录
6. 单实例锁：Electron 启动时获取用户数据目录下的锁文件

---

## 7. 新增 feature 验证清单

新增一个 feature（例如 `order`）时必须：

### 后端
- [ ] 在 `apps/api/src/app/modules/order/` 创建目录
- [ ] 新增 `models.py`、`schemas.py`、`repository.py`、`service.py`、`router.py`
- [ ] 在 `apps/api/src/app/main.py` 注册 router
- [ ] 运行 `alembic revision --autogenerate` 生成迁移脚本
- [ ] 运行 `pnpm contracts:generate && pnpm contracts:check` 确保契约漂移检测通过

### 前端
- [ ] 在 `apps/web/src/features/order/` 创建目录
- [ ] 新增 `api/index.ts`（从 `@agentflow/contracts` 导入类型）、`components/`、`hooks/`、`types.ts`、`index.tsx`
- [ ] 在 `apps/web/src/router/index.tsx` 注册路由

### 禁止
- [ ] ❌ 在 `modules/` 下建 `routers/` 或 `services/` 平铺目录
- [ ] ❌ 把 OrderList 组件放进 `shared/components/`
- [ ] ❌ 手写 API interface（必须从 contracts 导入）
- [ ] ❌ 让 `features/order/api/index.ts` 直接 import `features/workflows/api/index.ts`（feature 间通过后端 API 解耦）

---

## 8. 启动命令

```bash
# 开发模式（后端 FastAPI + 前端 Vite HMR）
pnpm dev:api    # 后端 127.0.0.1:8000，uvicorn --reload
pnpm dev:web    # 前端 localhost:5173，HMR 可用

# 一键启动（两个进程并行）
pnpm dev

# 契约层
pnpm contracts:generate   # 导出后端 OpenAPI
pnpm contracts:build      # 生成前端 TS 类型
pnpm contracts:check      # CI 漂移检测

# 构建
pnpm build

# 打包桌面应用（Phase 1+）
pnpm pack
```

---

## 9. 禁止变更清单

以下文件或约定**不得随意修改**，修改前必须在 commit message 中注明原因并做影响评估：

- `packages/contracts/` 目录结构（契约层的生成/校验脚本链）
- `apps/api/src/app/core/` 目录下任何文件（横切关注点的入口）
- `Electron preload.js` 的 contextBridge 白名单（安全边界）
- `AGENTS.md` 本身（本文件）
- `.editorconfig`（代码格式统一）
- Ruff / ESLint / Prettier 配置

---

**最后提醒：写代码前先想"这个文件应该放哪里"。如果答案不确定，回到本文件第 2、3、4 节对照。**
