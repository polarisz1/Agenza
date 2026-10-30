# AgentFlow 开发规划 · v0.3

> **本文件是唯一的阶段档案与下一步计划。** 编码前先查本文件与 `AGENTS.md`，避免在"该不该做 / 在哪个阶段 / 放哪个模块"上产生幻觉。
>
> **分工**：`AGENTS.md` = 硬约束（最高优先级）｜本文件 = 进度、计划、验收、决策记录｜`docs/code-review-2026-10-30.md` = 代码评审证据（缺陷 ID 的出处）。
>
> **v0.2 修订说明**：v0.1 存在三类问题——①状态标注与代码不符（§3 追踪表全表 ✗、`pyinstaller/backend.spec ✓`）；②里程碑叙述与自身验收矛盾（M0 90% 但 M3 已完成）；③只有历史、没有下一步。v0.2 以代码评审结论为准重写，并新增 M3.5 硬化阶段、待决策项与文档纪律。
>
> **v0.3 修订说明**：环境就绪后开始执行 M3.5。T1（测试与门禁）已完成并留下可验证证据；同时撤销了一条被实测证伪的 P0（B6），新增一条实测发现的 P1（S14）。后续每完成一个任务就更新 §5.1.1，不再事后补记。

---

## 0. 当前位置（2026-10-30）

| 项 | 状态 |
|---|---|
| 已交付阶段 | M0 脚手架 · M1 执行引擎 · M2 画布编辑器 · M3 配置打磨（部分收口） |
| **当前阶段** | **M3.5 硬化**（进行中：T1 测试与门禁已完成，T2 待开工） |
| 下一阶段 | M4 桌面化（前置技术验证未做） |
| 一句话判断 | **Web 形态端到端可演示；不可交付。** 主链路真实可用，但有 2 个"假功能"、1 个核心语义缺失、0 个自动化测试（T1 已补 25 条）、数据库无迁移；桌面化链路是不可运行的占位。 |
| 依据 | `docs/code-review-2026-10-30.md`（P0×5 / P1×23 / P2×35，均带文件行号；已按实测修订） |
| 环境 | 已就绪（Node 22 / pnpm 9.12 / Python 3.12，全在 E 盘），见 `docs/dev-environment.md` |

**为什么不能直接进 M4**：M4 的验收标准是"双击 exe 即用"，而当前 `run.py` 不接受 `--port`、`MOUNT_FRONTEND` 默认关闭、PyInstaller spec 是伪格式、exe/dist 三方路径不一致、单实例锁缺失，且 Python 脚本节点在冻结进程里根本跑不了。M4 不是"补自动更新"，而是"重做打包契约 + 一项冻结进程技术验证"。同时，没有测试网的重构去动桌面化，风险不可控；且 `vite-env.d.ts` 的 electron 类型引用疑似已让 `tsc -b` 失败，必须先实测确认前端是否还能构建。

---

## 1. 文档地图

| 文件 | 作用 | 何时读 |
|---|---|---|
| `AGENTS.md` | 目录/分层/契约/安全 硬约束 | 每次改代码前 |
| 本文件 | 阶段、计划、验收、决策 | 每次开工前 |
| `docs/code-review-2026-10-30.md` | 缺陷清单与证据（P0/P1/P2） | 修 bug 前 |
| `docs/dev-environment.md` | 本机环境布局（E 盘）与常用命令 | 开新 shell / 换机器时 |
| `docs/agentflow-prd.html` | 产品需求（功能定义） | 需求有歧义时 |
| `docs/agentflow-design.html` | 技术设计（D1–D12） | 架构决策时 |
| `docs/ui-design/index.html` | 视觉规范 | 改 UI 时 |

> 项目根 `README.md` 目前只有一行标题，计划在 M3.5-T9 补齐"快速开始"，它是新人/新会话的第一入口。

---

## 2. 事实基线（冻结项）

### 2.1 范围

| 项 | 值 |
|---|---|
| 产品形态 | 单用户、本地桌面应用（Electron 壳 + FastAPI + React） |
| 核心价值 | **过程可见**：每一步的输入/输出/耗时/消耗可回看 |
| 明确不做 | 多用户与权限、云端同步、在线模板市场、计费、移动端 |
| 触发方式 | 手动运行 + 单节点调试；定时触发在 P1 |

### 2.2 技术栈（变更需新增 ADR，不得随阶段悄悄替换）

| 层 | 选型 |
|---|---|
| Monorepo | pnpm workspace + Turborepo（JS）；uv 独立管 Python |
| 前端 | Vite 5 + React 18 + TS + React Router v6 + Zustand + AntD 5 + @xyflow/react |
| 后端 | Python 3.12 + FastAPI + Pydantic v2 + SQLAlchemy 2.0 + SQLite(WAL) + Ruff |
| 引擎 | 自研 DAG：RunManager + Kahn 分层 + semaphore(4) + EventBus→SSE |
| 契约 | FastAPI `/openapi.json` → `packages/contracts/openapi.yaml` → openapi-typescript |
| 桌面 | Electron + electron-updater + PyInstaller 单文件 exe |

### 2.3 安全基线实现状态（细则见 AGENTS §6）

| 基线 | 实现 | 备注 |
|---|---|---|
| Electron 三开关 | ⬜ | 代码已写对，但未打包验证 |
| 密钥 Fernet 加密 + 掩码 | ✅ | 解密失败静默返回空串（评审 G18） |
| Python 节点子进程 `-I -S` + tempdir + 超时 | ⚠ | 本地可用；**冻结后不可用**（评审 B5/§5） |
| SQLite WAL + 单写 | ✅ | |
| 路径穿越校验 | ✅ | `main.py` SPA 兜底已用 `resolve()` + 相对校验 |
| 单实例锁 | ⬜ | 未实现（评审 §5） |
| 数据目录与主密钥位置 | ⚠ | `DATA_DIR` 少算一层，实际落在 `apps/data`；打包后不可控（评审 S13 / D-3） |
| 只监听 127.0.0.1 | ✅ | |

### 2.4 待决策项（TBD）——**当前实现与建议**

| ID | 项 | 现状 | 建议 | 决策时点 |
|---|---|---|---|---|
| D-1 | 条件分支的图表示法 | 边只有 source/target，分支未实现 | 边加 `from_port`（取值 `true` / `false`，改动最小、与现有单 Handle 兼容） | M3.5-T3 前 |
| D-2 | 双运行入口 | `POST /api/runs?workflow_id=` 与 `POST /api/workflows/{id}/runs` 并存 | 保留后端 POST /api/runs 但标 deprecated，前端只用 workflows 入口 | M3.5-T6 |
| D-3 | 数据目录位置 | `config.py` 的 `ROOT_DIR` 少算一层 → 实际落在 `apps/data`；注释写的是 `AgentFlow/` | 开发态 `AgentFlow/data`，打包态 Electron `userData/agentflow`，由 env 显式注入 | M3.5-T8 |
| D-4 | 桌面更新范围 | 设计写了壳/后端/前端三层热更，代码零 | v0.1 只做壳更新；后端/前端热更延后 | M4 排期时 |
| D-5 | Python 节点在打包后的解释器 | 用 `sys.executable`，冻结后就是 exe 自己 | 三选一：随包内置精简解释器（+~30MB）／要求用户自备 Python／首版禁用并明确提示 | M4 前置验证 |
| D-6 | 契约兼容性门禁 | 只有漂移检查，无兼容性检查 | 引入 openapi-diff，破坏性变更需在 PR 描述里说明 | M3.5-T2 后 |
| D-7 | 成本展示 | 只存 token | 维持"只展示 token"，不换算费用 | P1 |
| D-8 | 运行保留条数 | 硬编码 `RUN_RETENTION=200`，设置页的同类项是装饰 | 打通设置项后再谈"可配置"，默认 200 | M3.5-T8 |
| D-9 | 界面语言 | 全中文硬编码 | 维持，不做 i18n | 不做 |

---

## 3. 已完成里程碑（归档）

> 约定：只有"验收命令跑过并留有输出"才能标 ✅。历史记录不改写，但**残余缺口必须列出来**，否则会再次出现"标了 ✅ 其实没做完"。

### 3.1 M0 · 脚手架 & CRUD ✅

**交付**：monorepo 结构 + 根配置 + 四 feature 的 router/service/repository/schemas/models + 引擎 8 子模块 + 8 执行器 + 契约脚本 + Electron/PyInstaller 模板 + 前端 4 页面 + UI 设计稿。
**验收**：`uvicorn app.main:app` 起服务建表；`GET /api/workflows` 返回统一信封；`tsc -b && vite build` 通过。
**残余**：当时的 Electron/PyInstaller 只是模板（评审 §5 已证明不可用），不该按"已交付"计。

### 3.2 M1 · 执行引擎 & 运行链路 ✅

**交付**：RunManager 生命周期与取消、Scheduler 分层调度（超时/重试/跳过传播）、EventBus + SSE（Last-Event-ID 补齐 + DB 兜底回放）、发起运行与单节点调试端点、`ApiResponse[T]` 统一信封、契约脚本跨平台化为 Node。
**验收**：串行/并行/条件/失败/取消六种图跑通；SSE 事件 seq 单调；重启后 running 运行被标记失败。
**残余**：条件节点只做判定未做分流（评审 B1，本次升级为 P0）；节点异常被 `gather` 吞掉（S11）；merge 顺序不确定（S3）。

### 3.3 M2 · 画布编辑器 ✅（压测未做）

**交付**：`@xyflow/react` 三栏编辑器、8 个自定义节点、节点库拖拽、属性面板、变量选择器、撤销栈（50 快照）、自动保存（2s 防抖 + 三态 + 失败不自动重试）、校验定位、运行抽屉、空态引导。
**验收**：浏览器实跑 10 步主流程；撤销/重做、自动保存、变量插入、状态徽标均验证。
**残余**：100 节点定量压测未做；视口不入撤销栈且永不落库（评审 F1）、参数草稿防抖会在切节点时丢失（F2）、未知节点类型被静默降级为 `python`（F7）；`updateNodeConfig` 靠属性面板 `onFocusCapture` 兜底入栈（粒度=一次聚焦，F9）。

### 3.4 M3 · 配置打磨 & 契约回归 ⚠ 部分收口

**交付**：4 个前端 api 模块全部改为 `@agentflow/contracts` 派生（无手写响应 interface）；PRD §8 异常场景逐条过；导入/导出（不含密钥）；SPA 挂载 + 路径穿越校验；日志脱敏；retention；provider 错误中文映射；UTC→本地时间统一。
**验收**：`contracts:generate/build/check` 全通；异常场景 11 条覆盖 10 条（"数据目录不可写"只做了失败横幅）。
**未收口（3 项，划入 M3.5）**：
1. 真实 provider 完整流程——**待密钥联调**（本机 Ollama 未运行）。
2. 100 节点定量压测——未做。
3. "数据目录不可写"只做横幅，未在只读磁盘实测。

### 3.5 历史缺陷修复记录（保留，防复现）

| 问题 | 根因 | 修复 |
|---|---|---|
| `uv run` 报 `Failed to initialize cache` | uv 缓存目录无写权限 | 直接用 `.venv\Scripts\python.exe`（**注意：`package.json` 的 `dev:api` 仍是 `uv run`，见 G13**） |
| `config.py` 里 `str / str` 报错 | `DATA_DIR: str = str(DATA_DIR)` 覆盖了 Path | 改 `@property secret_file` |
| `runs/repository.py` 报 staticmethod subscriptable | 缺 `from __future__ import annotations` | 顶部补 |
| `http.ts` TS1005 | 首行是 Python 三引号 | 改 `/** */` |
| `tsconfig.app.json` extends 不存在的包 | 引用了 `@tsconfig/react-native` | 移除 extends |
| 19 个 `.js` 误编译产物抢在 `.tsx` 前被解析 | 历史残留 | 全删 |
| AntD 5 Popconfirm `danger` 不存在 | API 迁移 | 改 `okButtonProps.danger` |
| `settings` 解构变量未使用 | — | 改 `[, setSettings]` |
| `./api` 相对路径错 | 组件在 `components/` 下 | 改 `../api` |

---

## 4. 质量现状与差距（评审摘要）

> 完整证据与行号见 `docs/code-review-2026-10-30.md`。本节只留"决策所需的结论"。

### 4.1 P0（阻断"完成"判定）

| ID | 问题 | 一句话后果 |
|---|---|---|
| B1 | 条件分支无分流（边无分支标记、节点单端口、调度器不读条件输出） | 两条分支都会执行——**看起来能用，行为相反** |
| B2 | 结构化抽取不读 `fields_text` | 用户填的目标字段零生效（假功能） |
| B3 | 零自动化测试 + 无 ESLint/Prettier 配置 + CI 无 pytest | 无回归网；前端 CI 必红 |
| B4 | `alembic/versions/` 为空，建表靠 `create_all` + 手写 ALTER | schema 变更是破坏性升级 |
| B5 | Python 节点用 `sys.executable` | 打包后会把整个后端当脚本拉起（M4 阻断） |

> 原 B6（`vite-env.d.ts` 挂 electron 类型导致构建失败）已实测撤销——`tsc -b` 通过，转 P2 卫生项。详见评审 §10.2。

### 4.2 P1（23 条，摘要）

**后端 14 条**：校验语义不一致（`ok` 只等于"无环"）｜变量只校验源不校验字段｜merge 顺序不确定｜provider 注册表单例竞态｜SSE 长连接占请求级 Session｜回放事件无 seq｜清空运行不删 node_run｜三个设置项空转｜Ollama `format:"text"` 必 400｜Anthropic JSON 模式不生效｜节点异常被吞｜全 skipped 误判 cancelled｜`DATA_DIR` 少算一层｜**根级数组下标 `{{ a[0] }}` 无法解析**。

**前端 9 条**：视口不入撤销栈且永不落库｜参数草稿防抖丢失/未 flush 就运行｜保存中 `saveNow` 返回 false 被当失败｜返回列表不 flush｜已存服务商"测试连接"必失败｜SSE `lastIdRef` 跨运行复用丢前段事件｜未知节点类型降级为 python｜节点重名导致变量歧义｜每次聚焦都压撤销栈。

### 4.3 模块完成度（以代码为准）

| 模块 | 完成度 | 卡点 |
|---|---|---|
| 契约层 | 85% | 节点配置无 schema（最大架构缺口）、错误无 schema |
| 执行引擎 | 75% | 条件分流、异常兜底、确定性 merge |
| 节点执行器 | 60% | extract 伪实现、condition 半实现、python 打包不可用 |
| Provider 适配 | 70% | Ollama/Anthropic 各一处真实失效、测试连接不带密钥 |
| 后端 modules | 70% | 分层偏差、设置项空转、清理不级联 |
| 前端编辑器 | 70% | 视口/选择不入撤销、连线环校验、节点专属渲染 |
| 运行观测 | 55% | 断线兜底、last_event_id 隔离、waiting_input 映射 |
| 模型设置 / 设置页 | 60% / 45% | 测试连接、启停开关；错误态、多数设置项不生效 |
| 质量门禁 | 10% | 无测试、无 lint、CI 假作业 |
| CI / 桌面壳 / 打包 | 45% / 45% / 15% | 无测试与缓存；单实例锁与进程回收；路径与资源对不上 |

---

## 5. 下一步路线图

### 5.1 M3.5 · 硬化（当前阶段）

**目标**：把"可演示"变成"敢交付"——补齐语义、立起质量网、修掉稳定翻车点、收拾工程债。**不新增功能面。**

**排期原则**：T1 先行（先实测构建、再立测试网）；T2 是 T3/T5 的前置；T6/T7/T8/T10 可并行；T9 收尾。

| 任务 | 内容 | 改动面 | 验收（可执行） |
|---|---|---|---|
| **T1 测试与门禁** | 装依赖后先实测构建（B6）；pytest 骨架 + 引擎/API 最小回归集；ESLint flat config + Prettier；CI 真跑 pytest 与 lint | `apps/web/src/vite-env.d.ts`、`apps/api/tests/**`、`eslint.config.js`、`.prettierrc`、`ci.yml`、`apps/web/package.json` | `pnpm --filter @agentflow/web build` 通过（B6 有结论）；`uv run pytest -q` ≥15 用例全绿；`pnpm --filter @agentflow/web lint` 0 error；CI 三 job 绿；故意破坏 `openapi.yaml` 能被 `contracts:check` 拦住 |
| **T2 节点配置契约** | `GraphDef.nodes` 改为 Pydantic 判别联合（8 类 config）；边加 `from_port`；重新生成契约；前端改用生成类型并删除手写 `WorkflowGraphJSON` | `modules/workflows/schemas.py`、`packages/contracts/**`、`features/workflows/types.ts`、`PropertyPanel.tsx` | `openapi.yaml` 出现 `NodeDef` 及 8 个 config `$defs`；`grep -c "as any" features/workflows` 归零；`contracts:check` 通过；`tsc -b` 通过 |
| **T3 条件分支端到端**（B1） | 边 `from_port` 参与调度；条件节点渲染 true/false 两个 Handle；校验规则；列表/详情展示"未激活分支" | `scheduler.py`、`BaseNode.tsx`、`types.ts`、`validators.py`、`WorkflowEditor.tsx` | 单测：A(condition)→B(true)/C(false)，运行后 B=success、C=skipped，且 seq 事件里 C 明确为 skipped；浏览器实跑一张分流图 |
| **T4 结构化抽取**（B2） | `fields_text` → JSON Schema 注入 prompt + 返回字段级校验；缺字段 = failed 且 error 列出缺失项 | `executors/extract.py`、`PropertyPanel.tsx`、`types.ts` | 单测：缺字段时 status=failed 且 error 含字段名；prompt 快照断言包含字段说明 |
| **T5 校验语义统一**（S1/S2） | `ok = not issues`；后端返回 `blocking`；前端删自建阻断集；变量校验至少到一级字段 | `validators.py`、`WorkflowService.validate`、`runs/service.py`、`types.ts` | 缺 output 节点 → 发起运行 422；`{{ 上游.不存在字段 }}` → 校验报 `UNKNOWN_FIELD`；前端"校验通过"与后端一致 |
| **T6 运行链健壮性**（S3/S4/S5/S6/S11/S12/F6） | 确定性 upstream 顺序；provider 快照不可变；SSE 不占请求 Session；回放事件带序号；`_run_one` 兜底记 failed；全 skipped 判 success；`lastIdRef` 随 url 重置 | `scheduler.py`、`providers/__init__.py`、`runs/router.py`、`manager.py`、`runs/service.py`、`useEventSource.ts` | 单测：merge 输出顺序稳定；运行中触发单节点调试不影响在途节点；SSE 重连后 seq 单调不重复；注入异常 → 该节点 failed 且运行 failed；连续两次运行都能收到 run.started |
| **T7 Provider 适配**（S9/S10/G18） | Ollama 仅在 json 模式带 `format`；Anthropic 加 `tool_choice` 并解析 `tool_use`；解密失败返回明确错误 | `providers/ollama.py`、`providers/anthropic_compat.py`、`security.py` | mock transport 断言 payload 字段；密钥损坏时错误信息含"密钥无法解密" |
| **T8 数据一致性与迁移**（B4/S7/S8/D-3） | alembic baseline + 启动 `upgrade head`；删 `_ensure_node_run_columns`；clear-runs 级联；retention/timeout 设置打通；输出超限截断 | `alembic/versions/*`、`db/database.py`、`settings/**`、`runs/service.py`、`core/config.py` | 空库 `alembic upgrade head` 建全表；`clear-runs` 后 `node_run` 计数=0；改设置项后行为随之变化；>1MB 输出被截断并标记 |
| **T9 工程收口** | `.gitignore` 修正（`*.spec.ts`、`build/`、`dist_electron/`、`electron/resources/`、`.build/`）；`.gitattributes`（LF）；`dev:api` 修正；README 快速开始；dev/prod 数据目录分离 | 根配置、`package.json`、`README.md` | 克隆后按 README 三步可跑起来；`git status` 干净；`.spec.ts` 不再被忽略 |
| **T10 前端一致性**（F1/F2/F3/F4/F5/F7/F8/F9 + G20/G21/G22） | 视口入快照并在 `onMoveEnd` 落库；草稿 flush（切节点/校验/运行/调试/返回前）；`saveNow` 复用 in-flight promise；测试连接改 test-by-id（后端解密）；未知类型占位而非降级；节点名唯一；聚焦/值变化才入栈；连线加环与入度校验；列表页补错误态 | `useEditorStore.ts`、`PropertyPanel.tsx`、`WorkflowEditor.tsx`、`useAutoSave.ts`、`ModelSettings.tsx`、`types.ts`、`WorkflowList.tsx`、`providers/service.py` | 改完参数立刻点运行 → 用的是新参数；视口缩放后刷新页面仍在；已保存服务商测试成功；第二次运行抽屉从"运行中"开始；未知节点不在保存时被改写 |

**M3.5 退出标准（同时满足才进 M4）**：
1. 评审报告 P0 全部关闭、P1 关闭 ≥18 条，剩余项有明确处置结论（已修 / 转 P2 / 明确不做）；
2. 后端测试 ≥15 条、前端 lint 0 error、CI 全绿、`pnpm --filter @agentflow/web build` 通过；
3. 条件分支、结构化抽取、校验一致性、图快照一致性四项各有单测 + 一次浏览器实跑记录；
4. `docs/code-review-2026-10-30.md` 里每条 P0/P1 标注处置结果。

#### 5.1.1 进度

| 任务 | 状态 | 证据 |
|---|---|---|
| 环境搭建 | ✅ | Node 22.23.4 / pnpm 9.12.0 / Python 3.12.13，全在 E 盘；见 `docs/dev-environment.md` |
| T1 测试与门禁 | ✅ | `tsc -b` 0；`vite build` 成功；eslint 0；prettier 全通过；pytest **25 passed / 3 xfailed**；ruff check+format 0；CI 三 job 重写 |
| T2 节点配置契约 | ✅ | 8 类 Node/Config schema 进 openapi；`GraphDef.nodes` 在 TS 侧是 8 类型联合；前端图类型全部从契约派生（`NodeType` 由联合反推），`features/workflows` 内 `as any` 归零；33 passed / 3 xfailed；contracts:check OK；8 节点 + 分支边端到端往返零丢失 |
| T3 条件分支 | ✅ | 调度器按 `from_port` 分流（未激活支 skipped 并写明原因）；条件节点渲染真/假双端口、边带标签；校验新增 `CONDITION_EDGE_NO_PORT` / `CONDITION_BRANCH_UNUSED` 提示；端到端用例经真实引擎验证 run=success / 真支 success / 假支 skipped、SSE 带原因。42 passed / 3 xfailed |
| T4 结构化抽取 | ⬜ 下一步 | `fields_text` 仍未参与 prompt 与结果校验 |
| T5 校验语义 | ⬜ | — |
| T6 运行链健壮性 | ⬜ | — |
| T7 Provider 适配 | ⬜ | 可独立开工 |
| T8 数据一致性与迁移 | ⬜ | — |
| T9 工程收口 | ⬜ | — |
| T10 前端一致性 | ⬜ | — |

**T1 期间新发现（已并入评审）**：CI 后端 job 原本是红的（ruff 207 错 + 52 文件未格式化）；`contracts:check` 在 Windows 因 CRLF 逐字节比较而假失败（已修脚本）；根级数组下标 `{{ a[0] }}` 不可用（记为 S14）。

### 5.2 M4 · 桌面化（未开始）

**前置技术验证（先做，可失败早止损）**：
1. 冻结进程能否跑 Python 节点（D-5 三选一）——这是唯一可能推翻桌面方案的技术点；
2. 后端 `--host/--port` 与数据目录/DIST 目录改为 **env + CLI 注入**（不再按 `__file__` 推算）；
3. 前端产物由后端挂载还是 Electron `loadFile` 二选一（当前两者都不成立）。

**任务**（在前置验证通过后）：

| 任务 | 内容 | 验收 |
|---|---|---|
| M4-T1 | `run.py` 解析 `--host/--port/--data-dir/--frontend-dist`；冻结时强制 `DEBUG=false`、`reload=false` | 打包 exe 用指定端口起来，`/health` 200 |
| M4-T2 | 重写 PyInstaller spec（Analysis/PYZ/EXE，真 spec 而非伪格式）并让构建脚本统一走它 | `pyinstaller pyinstaller/backend.spec` 产出 `backend.exe` |
| M4-T3 | 统一 exe 名称与路径：构建 distpath = builder extraResources 源目录 = `resources/backend/backend.exe` | 安装包里能找到 exe；主进程 spawn 成功 |
| M4-T4 | 前端资源落位（`resources/frontend-dist` + `MOUNT_FRONTEND` 或 `loadFile`） | 安装版首页是编辑器列表，不是 JSON/404 |
| M4-T5 | 单实例锁 + `second-instance` 唤起 + 进程树回收（Windows `taskkill /T /F`，`before-quit` 等待） | 双开只出一个窗口；退出后无残留 `backend.exe` |
| M4-T6 | 壳健壮性：后端启动失败要有错误页（不能白屏）；托盘"打开窗口"复用窗口；`setWindowOpenHandler` + CSP；图标补齐 | 断开后端启动 → 显示可读错误；连点托盘不产生多窗口 |
| M4-T7 | 壳自动更新（D-4：v0.1 只做壳；publish 仓库与 remote 对齐） | 从 Release 拉到新版并静默安装 |
| M4-T8 | 打包冒烟纳入 CI（Windows runner：装包 → 启动 → `/health` → 首页标题断言） | tag 构建前就暴露打包回归 |

**M4 退出标准**：全新 Windows 机器双击安装包即用；断网/断后端有明确错误；单实例生效；退出无残留进程；冒烟 CI 绿。

### 5.3 P1 及以后（不在 v0.1 范围）

| 项 | 说明 |
|---|---|
| 定时触发 | `apscheduler` 已在依赖里（目前是死依赖），届时启用 |
| 版本历史 | 现有 `graph_snapshot` 可作为基础 |
| 子工作流 / 人工确认 / 本地 RAG | PRD §11 后续 |
| 成本展示 | D-7 维持不做 |
| 性能基线 | 100 节点压测补齐（M2 遗留），目标：拖拽 ≥30fps、运行不阻塞 UI |

---

## 6. 执行规范（防幻觉）

1. **先确认再动代码**：阶段切换前用一句话确认"本轮动哪个任务、改哪些文件、是否允许改"。
2. **先读再写**：改任何文件前先读到最新内容，不凭记忆。
3. **路径必查**：引用跨模块路径前先确认文件存在。
4. **禁令必守**：`AGENTS.md` 的硬约束每次提交前对照（尤其是 modules/ 平铺目录、contracts 手写 generated、前端手写 interface）。
5. **历史缺陷不复现**：§3.5 的清单当 checklist 过一遍。
6. **TBD 不越界**：§2.4 里标"不做"的项，撞到了先停下来问，不要顺手实现。
7. **验证后交付**：前端 `tsc -b && vite build`；后端 `uv run pytest -q` + 起服务打接口；不能靠"看起来应该行"。
8. **新增 feature 必过 `AGENTS.md` §7 清单**（含 alembic revision 与 `contracts:generate && contracts:check`）。

### 6.1 文档纪律（v0.2 新增，针对 v0.1 的失效模式）

1. **状态只能由证据产生**：标 ✅ 必须同时写出"哪条命令 / 哪次实跑"。没有证据的标 ⚠ 或 ⬜。
2. **一个事实只写一处**：技术栈、目录约束、安全基线不在这里重抄，只引用 `AGENTS.md` / PRD。复制即漂移。
3. **里程碑收尾必须三件事**：更新本文件状态、更新差距清单、把验收命令固化进 `tests/` 或 CI。
4. **不许出现"全表 ✗"的追踪表**：要么维护成真实状态，要么删除。v0.2 以 §4 差距清单取代 v0.1 的 60 行 PRD 追踪表。
5. **文档与代码冲突时以代码为准**，并在下一次提交时修正文档。

---

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-10-30 | 初版：M0–M4 阶段档案 + PRD 追踪表 + 历史 bug 记录 |
| v0.2 | 2026-10-30 | 依据代码评审重写：修正矛盾状态；新增 M3.5 硬化阶段（T1–T10 + 退出标准）；新增待决策项 D-1…D-9；删除 60 行全 ✗ 追踪表，改为差距清单（P0×6 / P1×22 / P2×34）；新增文档纪律；M4 增加"前置技术验证"与打包任务重排；补记 `vite-env.d.ts` 构建阻断与数据目录位置问题 |
| v0.3 | 2026-10-30 | 环境就绪 + 开工。撤销 B6（实测构建通过，降为 G35）；新增 S14（根级数组下标不可用）；新增 §5.1.1 进度表；盘点更改为 P0×5 / P1×23 / P2×35；补充 `docs/dev-environment.md`；T1 完成（测试/ESLint/Prettier/CI 真跑） |
