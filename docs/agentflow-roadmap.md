# AgentFlow 阶段归档 · v0.1

> **本文件是开发工作的唯一阶段档案。** 后续编码前必须先查档，避免在"这个功能到底该不该做 / 放在哪个阶段 / 对应哪个模块"上产生幻觉。
>
> 配套文档：
> - `docs/agentflow-prd.html` v0.1 · 产品需求
> - `docs/agentflow-design.html` v0.2 · 技术设计
> - `docs/ui-design/index.html` · UI 视觉规范
> - `AGENTS.md` · 目录硬约束（优先级最高）

---

## 0. 事实基线（冻结，不得变更）

### 0.1 产品定位（PRD §1-4）

| 项 | 值 |
|---|---|
| 产品形态 | 单用户、本地桌面应用（Electron 壳内嵌 FastAPI + React） |
| 目标用户 | 独立开发者、研究者、内容运营人员；单机使用 |
| 核心价值 | **过程可见**——每一步的输入/输出/耗时/消耗可回看 |
| 不在范围内 | 多用户/权限、云端同步、在线模板市场、计费、移动端 |
| 触发方式 | 手动运行 + 单节点调试；定时触发在 P1 |

### 0.2 技术栈锁定（Design §D1 + AGENTS §5）

| 层 | 选型 | 约束 |
|---|---|---|
| Monorepo | pnpm workspace + Turborepo（JS）；uv 独立管 Python | 两套 workspace 不交叉，CI 分别调用 |
| 前端 | Vite 5 + React 18 + TypeScript + React Router v6 + Zustand + AntD 5 + @xyflow/react | 主色 `#1F4E3D`，`borderRadius: 10` |
| 后端 | Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.0 + SQLite WAL + uv + Ruff | 监听 `127.0.0.1` |
| 执行引擎 | 自研 DAG：RunManager + Kahn 拓扑分层 + asyncio.gather + Semaphore(4) + EventBus→SSE | 七类节点执行器 |
| 契约层 | FastAPI `/openapi.json` → `packages/contracts/openapi.yaml` → openapi-typescript → TS 类型 | **禁止手写接口** |
| 桌面壳 | Electron + electron-updater + PyInstaller 后端 exe | `contextIsolation=true` + `nodeIntegration=false` + `sandbox=true` |
| 密钥 | Fernet 加密；主密钥在用户数据目录生成 | 明文永不入库；接口只返回掩码尾号 |

### 0.3 目录硬约束（AGENTS §2-4）

**硬性禁令，违反即视为错误提交：**

```
# Python 后端
apps/api/src/app/modules/<feature>/
├── __init__.py
├── router.py     # 本 feature 全部 FastAPI 路由
├── service.py    # 业务逻辑编排
├── repository.py # SQLAlchemy ORM 查询
├── schemas.py    # Pydantic v2 schema（OpenAPI 单一事实源）
└── models.py     # SQLAlchemy 模型
# ❌ 禁止在 modules/ 下建 routers/、services/ 平铺目录
# ❌ 禁止跨 feature 直接 import 对方的 repository.py

# React 前端
apps/web/src/features/<feature>/
├── components/  # 仅本 feature 使用
├── hooks/
├── api/         # 从 @agentflow/contracts 导入类型
├── types.ts
└── index.tsx    # 入口
# ❌ 禁止业务组件进 shared/
# ❌ 禁止 feature 之间直接 import 对方的 api/ 或 components/

# 契约层
packages/contracts/
# ❌ 禁止手写 generated/ 目录
# ❌ 禁止手写前端 API interface（从 @agentflow/contracts 导入）
```

### 0.4 安全基线（AGENTS §6 + Design §D11）

1. Electron 壳 `contextIsolation=true` / `nodeIntegration=false` / `sandbox=true`
2. FastAPI 默认只监听 `127.0.0.1`
3. SQLite 单写锁 + WAL
4. Python 脚本节点：`python -I -S` 子进程 + 临时工作目录 + 超时 kill
5. 路径穿越校验：`Path.resolve()` + 白名单根目录
6. 单实例锁：Electron 壳获取用户数据目录下的锁文件

### 0.5 待定项（PRD §12，**暂不实现**）

| TBD | 说明 |
|---|---|
| 成本展示 | 是否按模型单价换算估算费用；本期只展示 token 用量 |
| 多实例并发 | 同一工作流是否允许同时发起多次运行；默认串行（Semaphore 4） |
| 运行保留策略 | 200 条为初始假设；待真实使用后确认 |
| 脚本节点能力范围 | 初始假设：允许标准库与网络请求，禁止读取工作流数据目录以外的路径 |
| 界面语言 | 默认简体中文；英文界面待定 |

---

## 1. 现状盘点

**盘点时间：2026-10-30 · M0 完成度 90%，M1/M2/M3 已完成；仅真实 provider 联调（需密钥）与 100 节点压测待补**

### 1.1 已落盘文件（不含 .venv / node_modules / dist）

#### 后端 apps/api（53 .py）

| 模块 | 文件 | 状态 | 备注 |
|---|---|---|---|
| core | main.py | ✓ | 四 router 注册 + CORS + 全局异常 + lifespan init_db + /health + 可选挂载前端 dist |
| core | config.py | ✓ | pydantic-settings；**已修复 SECRET_FILE / DATA_DIR bug** |
| core | security.py | ✓ | Fernet 加密/解密，`settings.secret_file` |
| core | response.py | ✓ | 统一 `{ code, message, data }` 响应 |
| core | logger.py | ✓ | loguru 配置 |
| core | exceptions.py | ✓ | `AppException` + 全局异常处理器 |
| core/api_deps.py | api_deps.py | ✓ | FastAPI dependency（get_db） |
| db | database.py | ✓ | SQLite PRAGMA（WAL / foreign_keys / busy_timeout=5000）+ init_db |
| run.py | run.py | ✓ | `uvicorn` 启动入口 |
| core/engine | contexts.py | ✓ | `NodeResult` + `NodeContext` + `NodeExecutor` Protocol |
| core/engine | variable.py | ✓ | `VAR_PATTERN` + `resolve()`；**失败抛 VariableError，不静默替换** |
| core/engine | validators.py | ✓ | `detect_cycle()` WHITE/GRAY/BLACK DFS + `validate_graph()` |
| core/engine | event_bus.py | ✓ | EventBus subscribe/unsubscribe/publish |
| core/engine | scheduler.py | ⚠ | `Scheduler.run()` 骨架按层 gather；**未实际调 event_bus.publish** |
| core/engine | registry.py | ✓ | `ExecutorRegistry` + `build_default_registry()` 注册 8 执行器 |
| core/engine | manager.py | ⚠ | `RunManager.start_run()` 骨架；**finalize 未落库，取消未实现** |
| core/engine/executors | base.py | ✓ | `BaseExecutor._resolve_config` 深度遍历解析 `{{}}` |
| core/engine/executors | input.py | ✓ | 工作流输入 |
| core/engine/executors | llm.py | ✓ | 模型调用 |
| core/engine/executors | extract.py | ✓ | 结构化抽取 |
| core/engine/executors | http.py | ✓ | httpx 请求 |
| core/engine/executors | python.py | ✓ | `asyncio.create_subprocess_exec(sys.executable, "-I", "-S", ...)` + tempdir + timeout kill |
| core/engine/executors | condition.py | ✓ | 6 种比较符；输出布尔，跳过未激活分支 |
| core/engine/executors | merge.py | ✓ | 合并多路输出 |
| core/engine/executors | output.py | ✓ | 最终输出 |
| core/providers | base.py | ✓ | `ChatResult` + `ProviderAdapter.chat()` 抽象 + `ProviderRegistry` |
| core/providers | openai_compat.py | ✓ | httpx 调 OpenAI 兼容接口 |
| core/providers | ollama.py | ✓ | `localhost:11434` |
| core/providers | anthropic_compat.py | ✓ | httpx 调 Anthropic 兼容接口 |
| core/providers | \_\_init\_\_.py | ✓ | `get_providers_registry()` 从 DB 加载启用服务商 |
| modules/workflows | models.py + schemas.py + repository.py + service.py + router.py | ✓ | 完整 CRUD + validate + duplicate；**已修复 from __future__ import annotations** |
| modules/runs | models.py + schemas.py + repository.py + service.py + router.py | ✓ | 完整 CRUD + SSE `/events` 端点；**SSE 返回空实现**；**已修复 annotations bug** |
| modules/providers | models.py + schemas.py + repository.py + service.py + router.py | ✓ | 完整 CRUD；**已修复 annotations bug** |
| modules/settings | models.py + schemas.py + repository.py + service.py + router.py | ✓ | 完整 CRUD + `/system/info` + `/system/clear-runs` |
| alembic | alembic.ini + env.py | ✓ | 导入四组 models 供 autogenerate |
| pyproject.toml | pyproject.toml | ✓ | deps + Ruff 配置 line-length=100, target py312 |

#### 前端 apps/web（22 文件）

| 模块 | 文件 | 状态 | 备注 |
|---|---|---|---|
| main.tsx | main.tsx | ✓ | ConfigProvider(zhCN, theme) + AntdApp + RouterProvider |
| styles | theme.ts | ✓ | `colorPrimary: '#1F4E3D'`, `borderRadius: 10` |
| styles | global.css | ✓ | React Flow 节点样式（选中态 `#1F4E3D` 外框） |
| router | index.tsx | ✓ | createBrowserRouter，lazy 加载各 feature |
| shared/lib | http.ts | ✓ | **已修复首行 Python 风格 `"""..."""`** |
| shared/components | AppLayout.tsx | ✓ | Sider(220) + Menu + Header；**已修复未使用的 ConfigProvider import** |
| features/workflows/api | index.ts | ✓ | listWorkflows/getWorkflow/createWorkflow/updateWorkflow/deleteWorkflow/duplicateWorkflow/validateWorkflow |
| features/workflows/components | WorkflowList.tsx | ✓ | Table + 搜索 + 复制/删除确认；**已修复 Popconfirm danger → okButtonProps + api 路径** |
| features/workflows/components | WorkflowEditor.tsx | ✓ | M2 已重写：@xyflow/react 画布 + 节点库 + 属性面板 + 运行抽屉 + 校验定位 |
| features/workflows/components/nodes/ | BaseNode + 8 类型节点 + nodeTypes | ✓ | M2 新增，自定义节点按类型渲染 |
| features/workflows/components/ | NodeLibrary / PropertyPanel / RunDrawer / RunInputsModal | ✓ | M2 新增 |
| features/workflows/hooks/ | useEditorStore / useAutoSave / useVariables | ✓ | M2 新增（撤销栈 / 自动保存 / 变量推断） |
| features/workflows/ | types.ts | ✓ | M2 新增（节点元数据 / 图序列化 / 端口矩阵） |
| features/workflows/components | WorkflowEditor.css | ✓ | feature 内局部样式（设计令牌复用） |
| features/workflows | index.tsx | ✓ | 入口导出 |
| features/runs/api | index.ts | ✓ | listRuns/getRun |
| features/runs/components | RunList.tsx | ✓ | Table + 状态筛选；**已修复 api 路径** |
| features/runs/components | RunDetail.tsx | ✓ | Descriptions + 节点结果列表；**已修复 api 路径** |
| features/runs | index.tsx | ✓ | 入口 |
| features/models/api | index.ts | ✓ | listProviders/createProvider/updateProvider/deleteProvider/testProvider |
| features/models/components | ModelSettings.tsx | ✓ | Table + Modal Form + 测试连接；**已修复 api 路径** |
| features/models | index.tsx | ✓ | 入口 |
| features/settings/api | index.ts | ✓ | getSettings/updateSettings/getSystemInfo/clearRuns |
| features/settings/components | AppSettings.tsx | ✓ | Form + 系统信息 + 危险操作；**已修复 Popconfirm + api 路径 + 未使用的 settings 变量** |
| features/settings | index.tsx | ✓ | 入口 |
| vite-env.d.ts | vite-env.d.ts | ✓ | `window.electronAPI?` 类型声明 |

#### 契约层 / 壳 / 打包

| 模块 | 状态 | 备注 |
|---|---|---|
| packages/contracts/openapi.yaml | ✓ | 由后端 `/openapi.json` 自动导出（禁止手改） |
| packages/contracts/scripts/generate.mjs + check.mjs | ✓ | 启动 apps/api → GET /openapi.json → 写 YAML；check 内容比对（跨平台，不依赖 bash/git） |
| packages/contracts/src/generated/ | ✓ | `openapi-typescript` 生成，含请求/响应类型（禁止手改） |
| electron/main.js + preload.js + electron-builder.yml | ✓ | 约 150 行，contextIsolation=true；**Phase 1+ 启用** |
| pyinstaller/backend.spec | ✓ | — |
| tools/scripts/dev.sh + pack-release.sh | ✓ | — |

#### 根配置

| 文件 | 状态 |
|---|---|
| AGENTS.md | ✓ |
| package.json | ✓ | scripts: dev/dev:api/dev:web/contracts:generate/contracts:build/contracts:check/pack |
| pnpm-workspace.yaml | ✓ | apps/web + packages/* |
| turbo.json | ✓ | tasks dev/build/contracts:build |
| .editorconfig / .gitignore | ✓ |
| .github/workflows/ci.yml + release.yml | ✓ |

### 1.2 已修复的历史 bug（编码/构建/运行）

| 问题 | 根因 | 修复 |
|---|---|---|
| `uv run` 失败 `Failed to initialize cache` | uv 缓存目录无写权限 | 改用 `.\.venv\Scripts\python.exe` 直接运行 |
| config.py `str / str` 报错 | `DATA_DIR: str = str(DATA_DIR)` 覆盖 Path 类型 | 改为 `@property secret_file` |
| runs/repository.py `staticmethod subscriptable` | 缺 `from __future__ import annotations` | 顶部补 |
| `http.ts` TS1005 `';' expected` | 首行是 Python `"""..."""` | 改为 `/** ... */` |
| tsconfig.app.json `@tsconfig/react-native not found` | extends 了不存在的包 | 移除 extends |
| 19 个 .js 误编译产物优先于 .tsx 被 Vite 解析 | 之前一次编码生成的残留 | 全部删除 |
| Popconfirm `danger` 不存在 | AntD 5 已移到 `okButtonProps.danger` | 修正 |
| `settings` 变量未使用 | AppSettings 里 destructor 未读 | 改为 `[, setSettings]` |
| `./api` 路径错 | 组件放 `components/` 但 import `./api` | 改为 `../api` |

### 1.3 遗留清单（带 ✅ 的行为 M1 已完成项，其余待后续阶段）

> 2026-10-30 M1 完成后，下表中引擎事件 / 取消 / 落库 / SSE / 发起运行 / 单节点调试 / validate 六类遗留已全部实现并验收通过。

| 项 | 位置 | 说明 |
|---|---|---|
| ~~RunManager.start_run() 不调 event_bus.publish~~ ✅ | `core/engine/manager.py` | M1 已实现 run.started / run.finished 事件 |
| ~~RunManager.cancel_run() 未实现~~ ✅ | `core/engine/manager.py` | M1 已实现：停止调度 + 终止在途节点 + 收尾落库 |
| ~~RunManager.finalize 不回写 run.node_run~~ ✅ | `core/engine/manager.py` + `modules/runs/service.py` | M1 已实现节点开始/结束双写，独立 Session |
| ~~Scheduler 不调用 EventBus~~ ✅ | `core/engine/scheduler.py` | M1 已实现 node.started / node.finished + 超时 + 重试 + 跳过传播 |
| ~~SSE 端点空实现~~ ✅ | `modules/runs/router.py` | M1 已实现 Last-Event-ID 补齐 + DB 兜底回放 |
| ~~`/api/workflows/{id}/runs` 发起运行端点缺失~~ ✅ | `modules/workflows/router.py` | M1 已实现 |
| ~~`/api/workflows/{id}/nodes/{node_id}/test` 单节点调试端点缺失~~ ✅ | `modules/workflows/router.py` | M1 已实现，不落运行记录 |
| ~~validate 只返回骨架~~ ✅ | `modules/workflows/service.py` | M1 已实际调用 `validators.validate_graph()` |
| ~~contracts/src/generated/index.ts 为空~~ ✅ | `contracts:generate` / `contracts:build` | 已生成；后端补 `ApiResponse[T]` 后响应类型也可用；脚本改为跨平台 Node（不再依赖 bash/uv/git） |
| ~~撤销栈~~ ✅ | 前端 Zustand slice 未建 | M2 已实现：nodes/edges 快照，上限 50 |
| ~~自动保存防抖~~ ✅ | 前端编辑器未接 | M2 已实现：停顿 2s 保存 + 三态反馈 + 失败重试 |
| ~~变量选择器（点击插入光标处）~~ ✅ | 前端属性面板未接 | M2 已实现：按祖先节点推断 + 上次运行输出 |
| ~~"调试此节点"按钮后端对接~~ ✅ | 前端属性面板按钮空 | M2 已接 `POST /nodes/{id}/test`，结果就地展示 |
| ~~画布撤销/重做/适应/自动布局~~ ✅ | 前端画布工具栏按钮空 | M2 已实现：撤销/重做/自动布局（自动 fitView） |
| ~~节点库搜索 & 拖拽到画布~~ ✅ | 前端节点库 input 空 | M2 已实现：搜索过滤 + 拖拽/点击添加 |
| Electron 壳 + PyInstaller 打包 | electron/ + pyinstaller/ 已写但**未启用** | **Phase 1+** |
| 三层自动更新链路 | 设计已写，代码零 | **Phase 1+** |

---

## 2. 分阶段规划

**设计文档 §D12 给出的 M0–M4 实施顺序，本轮细化为每个阶段的"目标 / 影响文件 / 验收标准 / 风险 / 待定"。**

### M0 · 脚手架 & CRUD · **已完成 90%**

**目标：** Monorepo 结构、根配置、四 feature 基础 CRUD、引擎与节点执行器骨架、编辑器静态骨架、UI 设计稿。

**本轮状态：** 目录 + 根配置 + 四模块 router/service/repository/schemas/models + 引擎 8 子模块 + 8 执行器 + 契约层脚本 + Electron/PyInstaller 模板 + 前端 4 页面 + 编辑器三栏骨架（示例数据） + UI 设计稿 `docs/ui-design/index.html` 均已落盘；**contracts/src/generated/ 为空**（缺一次 `pnpm contracts:generate && pnpm contracts:build`），**编辑器未接 @xyflow/react**，**运行链路零实现**。

**影响文件：**
- 后端：apps/api/src/app/ 全套 + alembic
- 前端：apps/web/src/ 全套 + packages/contracts/scripts/
- 根：package.json / pnpm-workspace.yaml / turbo.json / AGENTS.md / .editorconfig

**验收标准（已达成）：**
- [x] `uvicorn app.main:app` 启动，SQLite 五张表自动创建
- [x] `GET /api/workflows` 返回 `200 {"code":200,"message":"ok","data":{"items":[]}}`
- [x] `npx -y pnpm@9.12.0 --filter @agentflow/web run build` 通过（tsc -b && vite build 无报错）
- [x] `Get-Content docs/ui-design/index.html` 存在，7 屏可切换
- [x] AGENTS.md 目录硬约束已写入（modules/ / features/ / contracts/ 禁令）

**遗留（划入 M1 第一件事）：**
- contracts/src/generated/ 需先跑一次 `pnpm contracts:generate && pnpm contracts:build`，前端再改回 `import type from '@agentflow/contracts'`
- 引擎骨架需补齐：RunManager 实际调 EventBus、Scheduler 实际发 node.* 事件、finalize 落 node_run 表
- /api/workflows/{id}/runs 发起运行端点、/api/workflows/{id}/nodes/{node_id}/test 调试端点需建

---

### M1 · 执行引擎 & 运行链路 · **已完成（2026-10-30）**

**目标：** 让"▶ 运行"按钮真的能跑起来——从发起运行到 SSE 推事件到前端看到实时节点状态变化，全链路打通。

**前置：** M0 的 RunManager / Scheduler / SSE 骨架全部补齐。

**影响文件：**

| 位置 | 动作 |
|---|---|
| `core/engine/manager.py` | `start_run()` 调 `event_bus.publish("run.started")`；`_execute()` 在 Scheduler 返回后 finalize（汇总状态 + 写 run.finished_at + 推 run.finished）；`cancel_run()` 实现 |
| `core/engine/scheduler.py` | `run()` 每层 gather 前推 `node.started`，节点执行完推 `node.finished`；Semaphore(4)；跳过传播逻辑 |
| `core/engine/event_bus.py` | 加 run_id → list[asyncio.Queue] 的订阅者列表，`publish()` 时向所有队列推送事件 |
| `modules/runs/router.py` | SSE `/api/runs/{run_id}/events` 实现：连接时回放已落库的 node_run（Last-Event-ID），之后订阅 EventBus |
| `modules/runs/service.py` | `/api/runs` 列表、`/api/runs/{id}` 详情、`/api/runs/{id}/nodes/{node_id}` 单节点详情、`/api/runs/{id}/cancel` 取消、`/api/runs/{id}/rerun` 基于快照重跑 |
| `modules/workflows/router.py` | 增 `POST /api/workflows/{id}/runs`（发起运行，body 为 `{inputs}`，返回 run_id）、`POST /api/workflows/{id}/nodes/{node_id}/test`（单节点调试，不落运行记录） |
| `modules/workflows/service.py` | `validate()` 实际调 `validators.validate_graph()`，返回 `{ok, issues:[{node_id, code, message}]}` |
| `db/database.py` | `init_db()` 扫描已跑过的 running 状态 run，标记为 failed（"应用重启中断"） |
| 前端 `features/runs/api/index.ts` | 补 getRun/getRunNode/cancelRun/rerunRun |
| 前端 `features/workflows/api/index.ts` | 补 runWorkflow/testNode |
| 前端 `features/runs/hooks/useRunStream.ts` | 新建 EventSource hook，断线退避重连 + Last-Event-ID |
| 前端 `features/workflows/components/WorkflowEditor.tsx` | "▶ 运行" 按钮接 `runWorkflow`；底部运行面板接 `useRunStream` |

**验收标准（已全部通过 · 后端 28 项断言 + 浏览器实跑）：**
- [x] 1. Mock/脚本执行器跑通串行、并行（merge 两路）、条件、禁用节点跳过传播、失败、取消
- [x] 2. `POST /api/workflows/{id}/runs` 返回 run_id；节点执行完 `node_run` 表有记录（开始 running / 结束回写）
- [x] 3. SSE `/api/runs/{run_id}/events` 依次收到 run.started → node.started → node.finished → run.finished，seq 单调递增
- [x] 4. 前端底部运行面板实时追加节点级日志；`last_event_id=2` 重连只补发后续事件（浏览器实测一次运行成功）
- [x] 5. 取消运行：在途节点终止为 cancelled，未开始节点补记 cancelled，run 状态 cancelled
- [x] 6. 单节点调试：返回该节点输出，且不新增 run / node_run 记录
- [x] 7. SQLite 重启恢复：手工插入 running 运行后重启，状态变为 failed + error="应用重启中断"
- [x] 8. 契约层：`contracts:generate` / `contracts:build` / `contracts:check` 全部跑通；4 个前端 api 模块类型改为 `@agentflow/contracts` 派生

**M1 实现要点（供后续阶段参考）：**
- 事件：`EventBus` 每个 run 维护 seq + 最近 500 条事件历史，SSE `id` = seq；内存无历史时回放已落库 node_run
- 调度：`Scheduler` 支持节点级 `timeout_s`、重试 0–3（间隔 1s/2s/4s）、`enabled=false` 跳过、取消 Event + 单节点任务 cancel
- 变量：模板解析可见作用域 = 全部已完成祖先节点输出（按节点 id 与节点 name 双键），`NodeContext.available`
- 落库：引擎只调回调，`runs/service.py` 每个回调开独立 `SessionLocal`（请求级 Session 在响应后即关闭）
- 串行约束：同一工作流已有 running 运行 → `409`（TBD 多实例并发的默认策略）
- 契约：`core/response.py::ApiResponse[T]` 作为统一信封；各路由显式声明 `response_model=ApiResponse[Xxx]`，响应体才会进入 OpenAPI
- 契约脚本：`packages/contracts/scripts/generate.mjs` / `check.mjs`（Node 跨平台；默认端口 8765，可用 `AGENTFLOW_API_PORT` 覆盖；check 用内容比对，不依赖 git）
- 前端类型：4 个 `features/*/api/index.ts` 只从 `@agentflow/contracts` 派生（`components['schemas'][...]` + `ApiData<'/path','method'>`），禁止手写响应 interface

**风险：**

| 风险 | 影响 | 应对 |
|---|---|---|
| SQLite 写竞争 | 节点并发完成时写库抖动 | WAL + 单写锁 + 短 Session；如仍不足，后续切 PostgreSQL（已有配置项 `DATABASE_URL`） |
| SSE 与进程重启 | 运行中重启导致运行悬挂 | init_db 扫描 running run 标记为 failed（验收标准 #7） |
| EventBus 内存队列堆积 | 客户端断开未及时清理 | 客户端 onclose 时调用 unsubscribe；超时未拉自动丢弃 |

**待定（M1 内不解决）：**
- 多实例并发（TBD）：默认串行，同一工作流已有 running 则拒绝新运行（409）
- 成本展示（TBD）：本期只返回 tokens_in / tokens_out，不换算费用

---

### M2 · 画布编辑器 · **已完成（2026-10-30）**

**目标：** 把当前静态示例画布换成真实可交互的——节点库拖拽 / 连线 / 属性面板编辑 / 变量选择器 / 撤销重做 / 缩放平移 / 校验定位。

**前置：** M1 的运行链路打通（前端才能真正看到"▶ 运行"的结果）。

**影响文件：**

| 位置 | 动作 |
|---|---|
| `features/workflows/components/WorkflowEditor.tsx` | 重写为三栏 + `@xyflow/react` 画布；节点库拖拽；属性面板表单按节点类型映射；运行抽屉接 `useRunStream`；"调试此节点"接 `/nodes/{id}/test` |
| `features/workflows/hooks/useEditorStore.ts` | 新建 Zustand slice：nodes / edges / selection / dirty / undoStack（上限 50）。撤销栈保存序列化快照。参数输入 300ms 防抖提交 |
| `features/workflows/hooks/useAutoSave.ts` | 新建：dirty 变 true 后 2s 无输入 → `PUT /api/workflows/{id}` 保存 graph + viewport；保存失败时保留本地未提交修改并提示重试 |
| `features/workflows/hooks/useVariables.ts` | 新建：读取当前图内所有节点的输出结构（从 node_run 历史或 dry-run 推断），生成 `{{ 节点名.字段 }}` 可用变量列表 |
| `features/workflows/components/nodes/` | 新建 8 个自定义节点组件：input / llm / extract / http / python / condition / merge / output（按 Design §D9 "自定义节点组件按类型渲染"） |
| `features/workflows/components/NodeLibrary.tsx` | 从静态示例改成真实拖拽项 |
| `features/workflows/components/PropertyPanel.tsx` | 表单按节点类型映射；变量选择器插入光标处；最近输出拉 node_run 历史 |
| `features/workflows/components/RunDrawer.tsx` | 底部运行面板：Zustand run slice + `useRunStream` 合并事件；展开时间线日志 |
| `shared/hooks/useEventSource.ts` | 新建跨 feature 通用 SSE hook（**AGENTS §3 禁止反向依赖**，所以放 shared/hooks/） |

**验收标准（2026-10-30 浏览器实跑 10 步，主链路全通）：**
- [x] 1. 主流程走查：新建工作流 → 添加 3 个节点 → 连线 2 条 → 填参数 → 校验通过 → 运行成功 → 查看输出
- [x] 2. 节点库 8 个节点（四组）可拖拽 / 点击添加（浏览器验证点击添加；拖拽代码已接 `NODE_DRAG_MIME`）
- [x] 3. 连线从输出端口拖到输入端口，2 条边成功建立；`isValidConnection` 按端口类型矩阵拦截（extract/http 不接受 bool）
- [x] 4. 撤销/重做：节点增删、连线、位置拖拽、参数修改均入栈（浏览器验证增删 + 参数；上限 50 快照）
- [ ] 5. 100 节点图流畅度：已做 memo 节点 + 仅变更节点重渲染 + 参数 300ms 防抖，**尚未做 100 节点定量压测**
- [x] 6. 变量选择器：运行后可用变量实时出现 `{{ 脚本1.ok }}` 等，点击插入到光标处
- [x] 7. 校验：工具栏常驻；运行前自动校验；问题列表可点击定位节点（`fitView` + 选中）
- [x] 8. 自动保存：停顿 2s 保存；顶部显示 已保存/未保存/保存中/保存失败·重试
- [x] 9. 空画布空状态：「从左侧拖入输入节点开始」+ 顺序建议
- [x] 10. 运行中节点状态：排队 / 运行中 / 成功 / 失败 / 已跳过 / 已取消，文字 + 图标（角标）

**实际新增文件（M2）：**
- `components/nodes/`：`BaseNode.tsx` + 8 个类型节点 + `nodes.css` + `index.ts`（nodeTypes）
- `components/NodeLibrary.tsx`、`PropertyPanel.tsx`、`RunDrawer.tsx`、`RunInputsModal.tsx`
- `hooks/useEditorStore.ts`、`useAutoSave.ts`、`useVariables.ts`
- `types.ts`（节点元数据 / 默认配置 / 图序列化 / 端口兼容矩阵）
- 后端对齐：input 节点以 `config.key` 为准、output 节点支持 `config.field`、`ready` 状态要求无校验问题

**风险：**

| 风险 | 影响 | 应对 |
|---|---|---|
| 画布性能 | 大图拖拽掉帧 | 仅选中节点重渲染；属性表单防抖；必要时限制同屏节点数并提示 |
| Zustand 撤销栈溢出 | 50 快照上限 | 超过后丢弃最旧快照；序列化用 `JSON.stringify(JSON.parse(...))` 确保可还原 |
| 状态与持久化不一致 | 画布编辑 → 运行的 graph 快照可能不一致 | 运行发起时从 Zustand store 序列化 graph，快照写入 run.graph_snapshot；运行只读快照，不受后续编辑影响 |

**待定（M2 内不解决）：**
- 子工作流复用（P1 后续）
- 人工确认节点（P1 后续）

---

### M3 · 配置打磨 & 契约层回归 · **已完成（2026-10-30，真实 provider 待密钥）**

**目标：** 真实 provider 跑一次完整流程 + 异常场景逐条过 PRD §8 + 契约层从"手写类型"回归到"自动生成"。

**前置：** M1 引擎 + M2 编辑器都打通。

**影响文件：**

| 位置 | 动作 |
|---|---|
| `packages/contracts/` | 跑一次 `pnpm contracts:generate && pnpm contracts:build`，产出 `src/generated/index.ts`；`pnpm contracts:check` 加入 CI |
| `features/*/api/index.ts` | 全部从 `import type from '@agentflow/contracts'`；**删除手写 interface（如 WorkflowListItem / ProviderResponse / RunListItem）**——**执行 AGENTS §4 禁令** |
| `modules/providers/service.py` | 连接测试实际调 provider.adapter.chat() 返回 mock prompt；测试结果不改变已保存配置 |
| `features/models/components/ModelSettings.tsx` | "测试连接"按钮接 `/api/providers/test`；返回成功或具体错误（地址不可达 / 鉴权失败 / 模型不存在 / 超时） |
| `features/settings/components/AppSettings.tsx` | 补"导出备份"按钮接 `/api/system/export`；导入工作流接 `/api/workflows/import`（预览 → 确认 → 写入） |
| `features/workflows/components/WorkflowList.tsx` | 补"新建"空白 + 模板两种入口；按"全部 / 草稿 / 已就绪"筛选；按最近编辑 / 最近运行排序 |
| `features/runs/components/RunList.tsx` | 补按状态 / 工作流 / 时间范围筛选；"以此配置重新运行"按钮接 `/api/runs/{id}/rerun` |
| `features/runs/components/RunDetail.tsx` | 补逐节点时间线、错误堆栈摘要、"以此配置重新运行" |
| 异常场景逐条过 | PRD §8 11 条（存在环 / 节点未连线 / 缺少必填输入 / 模型未配置 / 接口限流 / 外部地址不可达 / 取消中间态 / 空工作流 / 删除被引用节点 / 导入冲突 / 数据目录不可写） |
| 安全对齐 | AGENTS §6 + Design §D11：密钥掩码尾号 / 日志过滤器拦截 `sk-` `Bearer` / 导出不含密钥 / 路径穿越校验 |

**验收标准（2026-10-30：后端 33 项断言 + 单元验证 + SPA 浏览器走查）：**
- [ ] 1. 真实 OpenAI / Ollama provider 完整流程：**待用户提供服务地址与密钥**（本机 Ollama 未运行）；适配层与错误映射已就绪
- [x] 2. PRD §8 异常场景：环检测、孤立节点、缺必填输入、模型未配置、重试（HTTP 不可达触发 2 次重试）、不可达失败、取消中间态、空工作流拦截、删除节点后未知变量校验（UNKNOWN_VARIABLE）、导入重名生成副本、保留策略
- [x] 3. `contracts:generate / build / check` 全部通过；CI 已包含 contracts:check 作业
- [x] 4. 4 个前端 `api/index.ts` 无手写 REST interface（SSE 事件类型除外，OpenAPI 不覆盖）
- [x] 5. `MOUNT_FRONTEND=true` 时 `/`、`/workflows/xxx` 返回 index.html，`/assets/*` 正常，`/api/unknown` 404，路径穿越 404
- [x] 6. 自动保存三态（已保存/保存中/保存失败·重试）+ 失败横幅 + `beforeunload` 未保存提醒（断网失败态未在浏览器实测）
- [x] 7. 每工作流保留最近 N 条运行（单元验证 keep=2 时旧记录被清理）——全局默认 `RUN_RETENTION=200`

**M3 落地要点：**
- 后端：`ApiResponse[T]` 契约、变量引用校验、导入（预览/确认+重名副本）、导出备份（不含密钥）、SPA 挂载、日志脱敏、retention、运行时间过滤、NodeRun started/finished 时间线、provider/HTTP 错误中文映射
- 前端：工作流模板与筛选排序、运行列表筛选/重跑、运行详情时间线/错误摘要/重跑、设置导出导入、保存失败横幅、UTC→本地时间统一
- 环境相关：本地/公司代理会拦截 `127.0.0.1` 请求，已在 httpx 层对本地地址关闭 `trust_env`

**风险：**

| 风险 | 影响 | 应对 |
|---|---|---|
| Provider 差异 | 各家 JSON 输出与用量字段不一致 | Provider 适配层归一化 `text / json / usage`，不支持的能力降级为文本解析 |
| 契约漂移 | 后端改 schemas.py 忘了跑 contracts:generate | CI contracts:check 阻断合并 |
| 密钥出站 | 接口/日志意外泄露完整密钥 | Fernet 加密 + 掩码尾号 + 日志过滤器拦截 `sk-` / `Bearer` 形态 |

**待定（M3 内不解决）：**
- 界面语言（TBD）
- 运行保留策略（TBD 200 条假设先保持）
- 成本展示（TBD）

---

### M4 · 桌面化 & 自动更新 · **Phase 1+，未开始**

**目标：** Windows 上双击 exe 即用；壳更新、后端更新、前端更新三层独立热更。

**前置：** M3 的 Web 应用完整可用。

**影响文件：**

| 位置 | 动作 |
|---|---|
| `electron/main.js` | 从模板完善：`spawn backend.exe`；`findFreePort()`；`waitForBackend(port)` 轮询 `/health`；托盘"打开窗口/打开数据目录/退出"；IPC：`get-backend-port` / `open-data-dir` / `notify` / `open-save-dialog` / `open-file-dialog`；`before-quit` / `quit` 时 kill 后端；单实例锁 |
| `electron/preload.js` | contextBridge 白名单：`getBackendPort` / `openDataDir` / `openSaveDialog` / `openFileDialog` / `notify` |
| `electron/electron-builder.yml` | 完善：appId `com.agentflow.app`，asar true，extraResources 含 frontend-dist + backend，win nsis x64 |
| `pyinstaller/backend.spec` | 完善 PyInstaller 单文件 exe 打包 |
| `electron/` | 加 electron-updater 三层自动更新：壳（electron-updater + Squirrel）、后端（bootstrap.bat 替换 exe 重启壳）、前端（原子替换 dist/ + SSE 通知 location.reload） |
| 前端 | `window.electronAPI?.getBackendPort()` 检测并切 baseURL |

**验收标准：**
1. Windows 上双击 exe 即用；无需额外数据库或中间件安装
2. 后端崩溃时主进程自动重启它，壳窗口存活
3. 壳更新从 GitHub Release 拉取并静默安装（Squirrel.Windows）
4. 后端更新下载新 exe → bootstrap 替换 → 壳重启
5. 前端更新下载 dist.zip → 原子替换 → SSE 通知软刷新 location.reload()
6. 三层更新独立、互不依赖；所有更新前校验 SHA-512，失败回滚
7. 单实例锁生效：双击第二个 exe 时拉起已有实例
8. 托盘菜单：打开窗口 / 打开数据目录 / 退出

**风险：**

| 风险 | 影响 | 应对 |
|---|---|---|
| Electron 体积 | 安装包 ~120MB | Chromium 固有成本；Tauri 更小但需 Rust + WebView2 实测 AntD5 兼容性 |
| Electron Defender 误报 | 首次安装被标记病毒 | EV 证书签名 + Windows Hardware Dev Center 提交；Phase 1 先用自签名 |
| PyInstaller 启动慢 | 冷启动 ~3s（+ SQLite 初始化） | 可接受；Electron 壳 10 秒内可打开工作流列表（PRD §10 非功能要求） |
| 三层更新链路复杂度 | 壳/后端/前端三种更新互不依赖但需协同 | 设计文档 §D8 表格已写清；实现前再仔细 review |

---

## 3. 功能需求追踪表（PRD §5 → 阶段 → 模块）

> 每行 = PRD 一个功能需求条目；"阶段"表示**首次交付**所在阶段；"后端"和"前端"给出对应的模块/组件名。

| PRD 节 | 需求 | 阶段 | 后端模块 | 前端组件 | 状态 |
|---|---|---|---|---|---|
| §5.1 工作流管理 · 列表 | 按名称搜索 / 草稿/就绪筛选 / 最近编辑/运行排序 | M0 | workflows | WorkflowList | ✗ |
| §5.1 · 新建 | 空白 + 模板两种入口 | M3 | workflows | WorkflowList | ✗ |
| §5.1 · 重命名 | 名称唯一，留空/重名原地提示 | M0 | workflows | WorkflowList | ✗ |
| §5.1 · 复制 | 副本追加"副本"，不复制密钥 | M0 | workflows | WorkflowList | ✗ |
| §5.1 · 删除 | 二次确认 + 明确提示运行记录一并删除 | M0 | workflows | WorkflowList | ✗ |
| §5.1 · 自动保存 | 停顿后保存草稿；三种反馈；保存失败本地保留 | M2 | workflows | WorkflowEditor (useAutoSave) | ✗ |
| §5.2 画布编排 · 节点库 | 4 组 8 项；关键字过滤；点击/拖拽添加 | M2 | — | NodeLibrary | ✗ |
| §5.2 · 连线 | 输出→输入；端口类型不兼容灰化 | M2 | — | WorkflowEditor | ✗ |
| §5.2 · 选中与属性 | 单击选中，右侧面板展示参数 + 变量 + 最近输出 | M2 | — | PropertyPanel | ✗ |
| §5.2 · 结构操作 | 框选 / 多选移动 / 删除 / 复制粘贴 / 撤销重做（50 快照上限） | M2 | — | WorkflowEditor (useEditorStore) | ✗ |
| §5.2 · 视图 | 缩放 / 平移 / 适应画布 / 自动布局 | M2 | — | WorkflowEditor | ✗ |
| §5.2 · 校验入口 | 工具栏常驻；运行前自动执行；列表定位到节点 | M2 | workflows | WorkflowEditor | ⚠ 骨架 |
| §5.3 节点类型 · 输入 | 字段名/类型/必填/默认值/说明 | M1 | engine/executors/input | nodes/InputNode | ⚠ 骨架 |
| §5.3 · LLM 调用 | 模型/系统/用户提示/温度/最大长度/输出格式 | M1 | engine/executors/llm | nodes/LlmNode | ⚠ 骨架 |
| §5.3 · 结构化抽取 | 待抽取内容/目标字段列表/字段说明 | M1 | engine/executors/extract | nodes/ExtractNode | ⚠ 骨架 |
| §5.3 · HTTP 请求 | 方法/地址/查询/头/体/超时 | M1 | engine/executors/http | nodes/HttpNode | ⚠ 骨架 |
| §5.3 · Python 脚本 | 脚本内容/超时；独立子进程 `python -I -S` + tempdir | M1 | engine/executors/python | nodes/PythonNode | ⚠ 骨架 |
| §5.3 · 条件分支 | 左值/比较符(6)/右值；只激活一条分支 | M1 | engine/executors/condition | nodes/ConditionNode | ⚠ 骨架 |
| §5.3 · 合并 | 全部到达/任一到达 + 结果字段名 | M1 | engine/executors/merge | nodes/MergeNode | ⚠ 骨架 |
| §5.3 · 输出 | 结果字段名/来源变量/展示格式 | M1 | engine/executors/output | nodes/OutputNode | ⚠ 骨架 |
| §5.3 · 通用设置 | 名称/启用开关/重试(0-3)/超时/备注 | M1 | engine/executors/base | PropertyPanel | ⚠ 骨架 |
| §5.4 变量引用 | `{{ 源.字段 }}`，`.field` + `[0]` 数组下标 | M1 | engine/variable | PropertyPanel (useVariables) | ⚠ 骨架 |
| §5.4 · 变量选择器 | 点击即插入光标处 | M2 | — | PropertyPanel | ✗ |
| §5.4 · 变量校验 | 引用不存在字段 → 运行前校验报错 | M2 | engine/validators | workflows.service.validate | ✗ |
| §5.5 运行与观测 · 发起运行 | 必填输入未填写先弹表单 | M1 | workflows (POST /runs) | WorkflowEditor | ✗ |
| §5.5 · 运行中反馈 | 节点状态实时 + 当前节点高亮 + 连线短暂高亮 | M2 | runs (SSE /events) | RunDrawer | ✗ |
| §5.5 · 实时日志 | 节点级追加 + 折叠/清空显示/复制 | M2 | runs (SSE /events) | RunDrawer | ✗ |
| §5.5 · 取消 | 已完成结果保留，正在执行 canceled，未开始 canceled | M1 | runs (POST /cancel) | RunDrawer | ✗ |
| §5.5 · 超时 | 节点级 `asyncio.wait_for`，整次无上限 | M1 | engine/scheduler | — | ⚠ 骨架 |
| §5.5 · 完成反馈 | 整体耗时/成功/失败/tokens；失败定位第一个失败节点 | M2 | runs | RunDetail | ✗ |
| §5.5 · 结果取用 | 输出节点一键复制；JSON 下载 | M3 | runs | RunDetail | ✗ |
| §5.6 节点调试 | 仅执行该节点；上游取最近成功输出或手动填写 | M1 | workflows (POST /nodes/{id}/test) | PropertyPanel | ✗ |
| §5.7 模型与密钥 · 服务商 | OpenAI 兼容 + Ollama + Anthropic 兼容；每类多实例 | M0 | providers | ModelSettings | ⚠ CRUD 已通 |
| §5.7 · 连接测试 | 保存前可测；返回成功或具体错误 | M3 | providers (POST /test) | ModelSettings | ✗ |
| §5.7 · 密钥展示 | 界面只显示 `••••xxxx`，编辑需重新输入完整值 | M0 | providers | ModelSettings | ✗ |
| §5.7 · 默认模型 | 新建 LLM 节点预选，逐节点可覆盖 | M2 | providers + workflows | nodes/LlmNode | ✗ |
| §5.7 · 可用性提示 | 引用的服务商被删/停用 → 校验报错 | M2 | workflows.validate | workflows | ✗ |
| §5.8 运行记录 · 列表 | 编号/工作流/状态/触发方式/时间/耗时/tokens | M1 | runs | RunList | ⚠ 骨架 |
| §5.8 · 筛选 | 状态/工作流/时间范围 | M3 | runs | RunList | ✗ |
| §5.8 · 详情 | 整体摘要/逐节点时间线/输入输出快照/错误堆栈 | M1 | runs | RunDetail | ✗ |
| §5.8 · 重新运行 | 使用快照结构 + 输入新建运行 | M1 | runs (POST /rerun) | RunDetail | ✗ |
| §5.8 · 保留策略 | 每工作流最近 200 条 | M1 | engine/manager | settings | ✗ |
| §5.9 本机设置 | 数据目录/占用大小/打开目录/导出备份 | M3 | settings (POST /system/export) | AppSettings | ✗ |
| §5.9 · 自动保存开关 | 设置页配置 | M3 | settings | AppSettings | ✗ |
| §5.9 · 运行日志保留条数 | 设置页配置 | M3 | settings | AppSettings | ✗ |
| §5.9 · 默认超时时间 | 设置页配置 | M3 | settings | AppSettings | ✗ |
| §5.9 · 界面语言 | 默认简体中文 | — | — | — | TBD |
| §5.9 · 导入工作流 | 选 JSON → 预览 → 确认写入 | M3 | workflows (POST /import) | WorkflowList | ✗ |
| §5.9 · 危险操作 | 清空全部运行记录 / 全部数据；需输入确认文字 | M3 | settings | AppSettings | ⚠ 骨架 |
| §6 主流程 | 新建 → 编排 → 校验 → 调试 → 运行 → 复盘 | M2 | 全链路 | 全链路 | ✗ |
| §8 异常边界 · 存在环 | 检测循环依赖 + 高亮环连线 + 禁止运行 | M2 | validators.detect_cycle | WorkflowEditor | ⚠ 骨架 |
| §8 · 孤立节点 | 提示"未连接到主流程" | M2 | validators.validate_graph | WorkflowEditor | ✗ |
| §8 · 缺少必填输入 | 运行前拦截 + 打开输入表单 | M1 | workflows | WorkflowEditor | ✗ |
| §8 · 模型未配置 | 节点失败，错误写明并跳转设置入口 | M1 | providers + llm.executor | PropertyPanel | ✗ |
| §8 · 限流/超时 | 按重试次数重试，间隔递增；最后保留响应体 | M1 | llm/http.executor | — | ✗ |
| §8 · 取消中间态 | 正在执行节点尽快终止 + 标记 canceled | M1 | manager.cancel_run | RunDrawer | ✗ |
| §8 · 空工作流 | 画布展示空状态引导 | M2 | — | WorkflowEditor | ✗ |
| §8 · 删除被引用节点 | 连线移除 + 变量标红 | M2 | validators | WorkflowEditor | ✗ |
| §8 · 导入冲突 | 同名默认生成副本名 | M3 | workflows | WorkflowList | ✗ |
| §8 · 数据目录不可写 | 显式错误 + 只读提示 + 不静默丢弃 | M3 | config + security | AppSettings | ✗ |
| §9 安全 | 单用户 / 密钥 Fernet 加密 / 脚本子进程隔离 / 路径穿越校验 / 单实例锁 | M3 | 全链路 | 全链路 | ⚠ 部分骨架 |
| §10 非功能 · 启动 | 桌面壳 10 秒内打开工作流列表 | M4 | electron | — | ✗ |
| §10 · 交互 | 100 节点内操作不明显卡顿 | M2 | — | WorkflowEditor | ✗ |
| §10 · 自动更新 | 三层独立热更 | M4 | electron | electron | ✗ |
| §11 后续 · 版本历史 | 保存关键版本 / 查看差异 / 回滚 | P1 | — | — | 暂不做 |
| §11 · 定时触发 | 定时 / 文件监听 | P1 | — | — | 暂不做 |
| §11 · 知识库检索 | 本地文档 RAG 节点 | P1 | — | — | 暂不做 |
| §11 · 人工确认 | 关键节点暂停等确认 | P1 | — | — | 暂不做 |
| §11 · 子工作流 | 封装为可复用节点 | P1 | — | — | 暂不做 |

---

## 4. 阶段切换确认点

每阶段**完成后**才允许进入下一阶段。切换前必须确认：

| 切换 | 必须达成 |
|---|---|
| M0 → M1 | ✅ `uvicorn app.main:app` 启动，`GET /api/workflows` 返回 200；✅ 契约层 `contracts:generate && contracts:build && contracts:check` 已跑通（后端响应模型 + 跨平台脚本）；✅ M1 引擎打通后画布才切真实 `@xyflow/react` |
| M1 → M2 | ✅ 2026-10-30 已达成：脚本执行器跑通串行/并行/条件跳过/失败/取消；SSE 实时收到事件；取消运行生效；单节点调试生效 |
| M2 → M3 | ⚠ M2 已完成：撤销重做正确、自动保存三态反馈、校验定位到节点均已验证；**100 节点定量压测尚未执行**，作为进入 M3 前的补测项 |
| M3 → M4 | ⚠ 契约与 CI、异常场景、SPA 挂载均已完成；**真实 provider 完整流程待密钥联调**；「数据目录不可写」只做了失败横幅，未实测只读磁盘 |
| M4 收尾 | ✅ Windows 上双击 exe 即用；✅ 三层自动更新生效；✅ Electron 安全基线全开；✅ Defender 误报缓解 |

---

## 5. 执行规范（避免幻觉）

> 基于经验 2133674 和 105761 的教训固化。

1. **规划阶段冻结范围：** 只产出文档与待确认问题清单。得到用户明确的"同意按阶段开始执行（从阶段 X 开始）"后才允许进入代码编辑。每次阶段切换前用一句话确认"本轮是否开始动代码、从哪个阶段开始、是否允许改动文件"。
2. **先读再写：** 动任何代码文件前先 `Read` 拿到最新内容。不凭记忆写。
3. **路径必查：** 引用跨模块路径前先 `Glob` 确认文件存在。不猜。
4. **禁令必守：** AGENTS.md 里的 8 条硬性约束每次 commit 前对照检查——尤其是 modules/ 下禁止 routers/services 平铺、contracts 禁止手写 generated/、前端禁止手写 interface。
5. **已修 bug 不复现：** 把 §1.3 "已修复的历史 bug" 和 "待修清单" 当作 checklist。提交前逐条过。
6. **待定项不越界：** PRD §12 五个 TBD（成本展示、多实例并发、保留策略、脚本能力、界面语言）在相应阶段**明确不做**。实现中如果撞到，停下来先问。
7. **验证后交付：** 每次功能改动后必须 `tsc -b && vite build`（前端）或 `uvicorn app.main:app` 启动测接口（后端）。不能靠"看起来应该行"就交付。
8. **新增 feature 必查 §7 验证清单：** AGENTS.md §7 列了新增 feature（例如 order）要创建/修改的所有文件。按清单执行。
