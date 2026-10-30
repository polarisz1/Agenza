# AgentFlow 代码评审报告 · 2026-10-30

> **评审对象**：`docs/agentflow-roadmap.md`（v0.1）声称已完成的 M0–M3 全部代码（HEAD = `ea66bfe`），以及已落盘但未启用的壳/打包占位代码（只作为 M4 的前置风险给出结论）。
>
> **判据**：`AGENTS.md`（硬约束）→ `docs/agentflow-prd.html`（功能）→ `docs/agentflow-design.html`（技术）→ roadmap 自身声明的验收标准。
>
> **方法**：逐文件通读 `core/engine/**`、`core/providers/**`、`modules/**`、`features/**`、`packages/contracts/**`、`electron/**`、`pyinstaller/**`、`.github/workflows/**`；前后端交叉核对字段名与 OpenAPI 产物；对每条结论标注证据位置（`文件:行`）。
>
> **一句话结论**：Web 形态的主链路（编辑 → 校验 → 运行 → SSE → 回放）真实可用，代码质量**高于** roadmap 自述的完成度；但同时存在 **2 个"假功能"、1 个核心语义缺失、0 个自动化测试、0 份 lint 配置、数据库无迁移**，桌面化链路则是**不可运行的占位**。当前状态是"可演示"，不是"可交付"。

---

## 0. 结论摘要

| 类别 | 结论 |
|---|---|
| 架构与分层 | 基本符合 AGENTS.md；偏差：`settings` 缺 `repository.py`、`core/providers` 反向依赖 `modules/providers`、repository 层自行 commit |
| 执行引擎 | 分层调度/取消/重试/超时/事件/落库齐全；缺条件分流、节点异常被静默吞掉、merge 顺序不确定 |
| 节点执行器 | 8 个齐备但完成度不均：`extract` 是"LLM + JSON 解析"的伪装，`condition` 有判定无分流，`merge` 的 `any` 语义不成立 |
| Provider 适配 | 三适配器齐全；Ollama 的 `format:"text"` 会 400、Anthropic 的 JSON 模式不生效、注册表可变单例有竞态 |
| 契约层 | 22 个路径与后端**完全一致**，生成/校验脚本可用（本项目质量最高的部分）；但**节点配置没有 schema**，前端只能手写图类型并用 `as any` 绕过 |
| 前端 | 编辑器/撤销/自动保存/变量推断/SSE 都真实实现且细节克制；但存在"草稿未 flush 就用旧图运行""第二次运行丢前段事件"两类真实故障 |
| 质量门禁 | **零自动化测试**（`apps/api/tests/` 只有 `conftest.py`）、CI 无 pytest 步骤、**无 ESLint/Prettier 配置文件**（`pnpm lint` 必失败）、`alembic/versions/` 为空 |
| 桌面化 | `run.py` 不接受 `--port`、`reload=DEBUG(默认 True)`、PyInstaller spec 是伪格式、exe/dist 三方路径不一致、`MOUNT_FRONTEND` 无人设置 → **打包链路跑不起来** |
| 缺陷计数 | P0 × 5、P1 × 23、P2 × 35（已按实测修订，见 §10） |

**可信度提示**：roadmap v0.1 的 §1.1 文件清单与 §3 PRD 追踪表已严重过时（`scheduler.py` 标"未实际调 event_bus.publish"、§3 全表 ✗、`pyinstaller/backend.spec ✓`），且 §3 大量 ✅ 与代码不符。**本报告一律以代码为准，不以文档为准。**

---

## 1. P0 · 阻断级——不修就不能说"这个功能做完了"

### B1 · 条件分支：有判定、无分流（PRD §5.3「只激活一条分支」未实现）

| 环节 | 证据 | 现状 |
|---|---|---|
| 图模型 | `apps/web/src/features/workflows/types.ts:257` | 边只有 `{id, source, target}`，**没有任何分支标记** |
| 节点端口 | `apps/web/src/features/workflows/components/nodes/BaseNode.tsx:50-59` | 每节点只有**一个** source Handle，条件节点无法引出 true/false 两路 |
| 执行器 | `apps/api/src/app/core/engine/executors/condition.py:42` | 输出 `{condition, true_branch}` 后结束 |
| 调度器 | `apps/api/src/app/core/engine/scheduler.py:124-148` | 只按"上游是否 skipped/cancelled/failed"决定跳过，**完全不读条件节点的输出** |

**后果**：条件节点的两条下游分支**都会执行**。用户画出的"分流"只是视觉效果，运行行为与预期相反——这是最危险的一类缺陷（看起来能用）。
**修复**：边新增 `from_port: "true" | "false"`；`BaseNode` 对 condition 渲染两个 Handle；`scheduler._run_one` 收集上游时，若上游为 condition 且 `输出.condition !== 边.from_port`，视为该分支未激活（记为 skipped）；`validators` 增加条件端口连线规则；`GraphDef.edges` 的 schema 同步（见 A1）。

### B2 · 结构化抽取是"假功能"（PRD §5.3「目标字段列表 / 字段说明」未实现）

`apps/api/src/app/core/engine/executors/extract.py:11-24` 的实际逻辑 = 复用 LLM 执行器 + `format="json"` + `json.loads`。
`config["fields_text"]`（属性面板 `PropertyPanel.tsx:424-425` 让用户逐行填写目标字段）**在整条链路上无人读取**，`types.ts:113` 的默认值也从未被消费。

**后果**：用户填了目标字段却对结果零影响，抽取质量完全取决于用户在 `prompt` 里怎么手写。
**修复**：`fields_text` → 生成 JSON Schema（字段名 + 说明）注入 system prompt，返回后做**字段级校验**（缺字段 = failed，错误信息列出缺失项）；同时把 `fields_text` 升级为结构化 `fields: [{name, desc, type}]`（与前端的图契约一起改）。

### B3 · 质量门禁为零

| 项 | 证据 | 影响 |
|---|---|---|
| 后端测试 | `apps/api/tests/` 仅 `__init__.py` + `conftest.py`，**无任何 `test_*.py`** | 曾经的"28 项 / 33 项断言"是临时脚本，**未沉淀为回归测试**；后续任何重构都没有安全网 |
| CI 后端 | `.github/workflows/ci.yml:28-40` 名为 "Backend lint + test"，**没有 pytest 步骤** | 名字骗人，测试永远不会被跑 |
| 前端 lint | 仓库内**不存在** `.eslintrc*` / `eslint.config.*` / `.prettierrc*` | `apps/web/package.json:10` 的 `lint: eslint . --ext ts,tsx` 会直接报 "No ESLint configuration found"；CI 的 web job **必然红** |
| 契约构建 | `ci.yml` 只跑 `contracts:check`，不跑 `contracts:build` | 生成产物是否可复现未验证 |

**修复**：① 补最小回归集（见 roadmap M3.5-T1）；② CI 加 `uv run pytest -q`；③ 补 ESLint（flat config + `@typescript-eslint` + `react-hooks`）与 Prettier，`lint` 硬化为 `--max-warnings=0`；④ CI 跑 `contracts:build` 后 `git diff --exit-code`。

### B4 · 数据库无迁移（AGENTS §7 必做项未做）

`apps/api/alembic/versions/` 只有 `README.txt`；建表靠 `init_db()` 的 `Base.metadata.create_all()`（`db/database.py:57`）+ 手写 `ALTER TABLE`（`db/database.py:62-71`）。

**后果**：字段变更只能靠"再写一段 `_ensure_*_columns`"；无法回滚、无法审计、无法迁移 PostgreSQL（`DATABASE_URL` 已经预留了切换能力）。
**修复**：以当前 schema 生成 baseline revision，`create_all` 降级为仅测试/首次引导，删除 `_ensure_node_run_columns`。

### B5 · Python 节点在打包后不可用

`executors/python.py:57` 用 `sys.executable` 启动子进程。PyInstaller 单文件模式下 `sys.executable` 就是 `backend.exe` 自身 → 打包后执行脚本节点等于**再启动一个后端进程**（且带 `-I -S` 参数它也不认）。
**后果**：M4 的核心能力（脚本节点）在桌面上直接失效，且失败形态诡异（多一个卡住的进程，而不是清晰的报错）。
**修复**见 roadmap D-5：内置精简解释器 / 要求用户自备 / 首版禁用并明确提示，三选一，且必须在 M4 排期前完成技术验证。

### ~~B6~~ · 【已撤销】原判"前端构建阻断"，实测不成立

原判断依据：`apps/web/src/vite-env.d.ts:2` 有一条 `/// <reference types="electron" />`，而 `electron` 包不在 web workspace 内，静态推断会报 TS2688。

**实测结果（2026-10-30，装好 Node 22 / pnpm 9.12 后）**：`tsc -b --force` 退出码 0，`vite build` 成功；另用 `/// <reference types="zzz-does-not-exist" />` 做对照实验同样退出 0——**本项目的 tsconfig 组合下悬空 types 引用不会阻断构建**。

处置：该行已删除（避免误导），降级为 P2 卫生项（G35）。教训：**没有跑过的结论不得写成 P0**，这正是 §6.1 文档纪律第 1 条的由来。

---

## 2. P1 · 严重——行为与声明不一致，或会在真实使用中稳定翻车

### 2.1 引擎与后端（S）

| ID | 位置 | 问题 | 后果 / 修复 |
|---|---|---|---|
| S1 | `validators.py:134` + `runs/service.py:80-83` + `types.ts:182` | `validate_graph()` 的 `ok` **只等于"无环"**；`MISSING_INPUT/OUTPUT`、`ISOLATED`、`UNKNOWN_VARIABLE` 都进 issues 却不让 `ok=False`。后端发起运行只判 `ok`，前端却自建 `BLOCKING_ISSUE_CODES` | UI 出现"校验 3 个问题但运行仍可点"。统一 `ok = not issues` + 后端返回 `blocking`，前端不再自建阻断集 |
| S2 | `validators.py:37-50` | 变量校验只查"源"存在，**不查字段**（PRD §5.4 要求"引用不存在字段 → 运行前报错"） | 该需求实际未实现。建议复用节点输出 schema 推断（与 A1 同源），至少校验到一级字段 |
| S3 | `scheduler.py:53-55` + `executors/merge.py:16-21` | `parents` 是 `set`，`ctx.upstream` 顺序**不确定** → merge 输出数组顺序随机；`strategy="all"` 也不校验"是否全部到达" | 同图两次运行结果不同，无法复现。按 edges 顺序排序 + merge 记录 `arrived/total` |
| S4 | `providers/__init__.py:17-33` | 全局 `_registry` 单例，**每次 `get_providers_registry()` 都 clear + 重建**；`start_run` 与 `test_node` 都会调用 | 运行中做一次单节点调试，在途 LLM 节点可能拿到 `None` → 误报"服务商已停用"。改为每次构建**新** registry 并快照给本次运行 |
| S5 | `runs/router.py:96` | SSE 端点用 `Depends(get_session)` 持有请求级 Session **直到流结束** | 一次运行期间持续占用连接；多个 SSE 客户端 + SQLite 单写会耗尽连接池。进入流之前用短生命周期 `SessionLocal` 读一次并关闭 |
| S6 | `runs/router.py:166-186` | 内存无历史时的 DB 回放事件**没有 `seq`** | 前端 `Last-Event-ID` 无法对齐（`id:` 为空被跳过），重连可能重复或断档。回放需带确定性序号或改用独立游标 |
| S7 | `settings/router.py:29-35` | `clear-runs` 只删 `run`，**不删 `node_run`** | 孤儿数据只增不减；`system/info` 计数与实际存储不符 |
| S8 | `settings/service.py:14-19` | `retention_per_workflow` / `default_timeout` / `auto_save` 三个设置项**无任何消费方**（引擎用 `settings.RUN_RETENTION` 与节点 `timeout_s`，自动保存写死 2s） | 设置页是"装饰"，改设置没有任何效果，比没有设置项更伤信任 |
| S9 | `providers/ollama.py:34` | 把 `format: "text"` 发给 Ollama `/api/chat`（该字段只接受 `json` 或省略） | LLM 节点在 Ollama 下大概率 400。仅在 json 模式带 `format` |
| S10 | `providers/anthropic_compat.py:37-41, 54-58` | JSON 模式只加 `tools` 定义，**没有 `tool_choice`，也不解析 `tool_use` 块**（只拼 text 块） | 结构化抽取在 Anthropic 下静默失效（拿到空文本 → "JSON parse failed"） |
| S11 | `scheduler.py:94` | `asyncio.gather(..., return_exceptions=True)` 且 `_run_one` **无 try/except** | 节点执行中的意外异常（如 `node_map` KeyError）被吞掉，该节点既无结果也无记录，运行仍可能判 success → **节点漏跑而无人知晓** |
| S12 | `manager.py:178-179` | 全部节点 skipped/cancelled 时判为 `cancelled` | "全部节点被禁用"的工作流显示"已取消"，误导 |
| S13 | `core/config.py:11-12` | `ROOT_DIR = parents[4]` 实际是 `apps/`（注释写 `AgentFlow/`）→ `DATA_DIR` 落在 `apps/data`；冻结后变成 `%LOCALAPPDATA%\data` | 数据与 Fernet 主密钥位置不受控，升级/清理可能丢库；打包前必须改为 env 显式注入 |
| S14 | `core/engine/variable.py:42-58` | **根级数组下标解析不了**：`{{ a[0] }}` / `{{ a[0].c }}` → `Unknown variable source: 'a[0]'`（`source_key` 直接拿 `a[0]` 去 `scope.get`）；只有 `{{ a.list[0] }}` 这种"字段后再下标"可用 | PRD §5.4 明确要求"`.field` + `[0]` 数组下标"，当前表达式写不出来。修法：先用正则把源与路径切开，再交给 `_resolve_path` 统一走 token 解析（已有测试 `test_resolve_root_level_array_index` 标 xfail 作为验收） |

### 2.2 前端（F）

| ID | 位置 | 问题 | 后果 / 修复 |
|---|---|---|---|
| F1 | `useEditorStore.ts:22, 127` | 撤销快照只存 nodes/edges；`setViewport` 不置 dirty/rev | 撤销不还原视口；**平移缩放永不落库**（除恰好有别处修改）；viewport 入快照 + `onMoveEnd` 节流保存 |
| F2 | `PropertyPanel.tsx:75-81` | 参数 300ms 防抖 + effect cleanup：切节点瞬间最后一次输入被丢弃；校验/运行/调试读的是**已落库的图**（`runs/service.py:41`），草稿未 flush | "刚改的参数没生效就跑了"。切节点前 flush；校验/运行前先 flush 草稿 |
| F3 | `useAutoSave.ts:21` | 保存中 `saveNow()` 直接 `return false`，`WorkflowEditor.tsx:305/340/398` 一律当成"保存失败" | 保存进行中点击校验/运行 → 报"保存失败"并中止。复用同一个 in-flight promise |
| F4 | `WorkflowEditor.tsx:412` | 返回列表既不 flush 也无路由离开确认（只有 `beforeunload`） | 2s 防抖窗口内点返回 → 丢编辑。返回前 `await saveNow()` |
| F5 | `ModelSettings.tsx:72-74` | "测试"按钮只提交 `kind/name/base_url/default_model`，**不带已存密钥**；后端 `providers/service.py:89-100` 只用 `body.api_key` | **已保存服务商的"测试连接"必然鉴权失败**。加 test-by-id（后端解密后测） |
| F6 | `shared/hooks/useEventSource.ts:37, 57` | `lastIdRef` 跨 url 复用，新 run 会带上一次运行的 seq 作为 `last_event_id` | 第二次运行**丢掉 run.started 等前段事件**（抽屉停在"未运行"直到首个节点事件）。url 变化时重置 ref |
| F7 | `types.ts:317` | 未知节点类型静默回落 `python` | 打开新版/旧版图会**改变节点语义并在下次保存写坏数据**。降级为不可运行占位节点并提示 |
| F8 | `useEditorStore.ts:182` | 新节点序号 = 同类型数量 + 1，删除后再建会重名（`LLM2` × 2） | 节点名是变量引用源，重名导致 `{{ LLM2 }}` 歧义。生成唯一名称 |
| F9 | `PropertyPanel.tsx:178` | `onFocusCapture={beginHistory}` 每次聚焦都压栈（内容没变也压） | 撤销"按了没反应"（要连按多次才有效）。值真正变化时才入栈 |

### 2.3 其余
F1–F9 以外没有其他前端 P1；构建阻断见 B6。桌面/打包类问题集中在 §5，按 M4 前置处理。

---

## 3. P2 · 一般——可容忍，但会持续产生摩擦

| ID | 位置 | 问题 |
|---|---|---|
| G1 | 17 处（`modules/*/repository.py`、`settings/service.py`、`settings/router.py`、runs 回调） | repository 层自己 `commit()`，事务边界散落；多步写（duplicate / import / 保留策略清理）无法原子 |
| G2 | `modules/settings/` | **缺 `repository.py`**（AGENTS §2.1 硬约束），`router.py:29-35, 51-65` 直接在路由里写 SQL 并 import 模型 |
| G3 | `modules/{runs,providers,settings}/` | **缺 `__init__.py`**（AGENTS §2.1 要求），当前靠命名空间包侥幸运行 |
| G4 | `settings/router.py:25` | `update_settings(data: dict)` → OpenAPI 里是无类型 object，破坏"Pydantic 为单一事实源" |
| G5 | `runs/router.py:54` + `workflows/router.py:118` | 两个入口都能发起运行（`POST /api/runs?workflow_id=` 与 `POST /api/workflows/{id}/runs`），语义重复 |
| G6 | `runs/service.py:73-75` | "同工作流已有 running 则 409"是读后写，**非原子**；双击"运行"可能起两次 |
| G7 | `workflows/router.py:96` | `POST /{wf_id}/validate` 的 `wf_id` 声明为可空（`str` 或 `None`），但它是路径参数、永远不为 None；与 `/validate` 端点语义重叠；OpenAPI 里同时 required + nullable |
| G8 | `executors/http.py:44-57`、`runs/service.py:288-292` | HTTP 响应与节点输出全文入 `output_json`，**无大小上限**；一次下载大文件就撑爆 SQLite |
| G9 | 全仓 | `datetime.utcnow()`（3.12 已弃用）+ 无时区标记，靠前端 `datetime.ts` 补偿 |
| G10 | `executors/python.py:56-68` | 子进程未做环境变量白名单、stdout/stderr 无上限、超时 kill 后未 `await proc.wait()` |
| G11 | `.gitignore:14-18` | `*.spec.ts` 会静默忽略前端测试；`build/` 误伤 `electron/build/icon.ico`；`electron/resources/`、`dist_electron/`、`.build/` **未被忽略**（构建产物可被提交） |
| G12 | `pyproject.toml:17` | `apscheduler` 已声明但无任何定时调度代码；`dev` extra 声明 pytest 却无测试 |
| G13 | 根 `package.json` | `dev:api` 仍是 `uv run python -m app.run`，与 roadmap §1.2"uv 缓存无权限 → 改用 `.venv\Scripts\python.exe`"的结论冲突 |
| G14 | 仓库根 | `README.md` 只有一行标题；`node_modules` / `.venv` / `data/` 均不存在 → 克隆后无法直接运行，无快速开始 |
| G15 | `executors/condition.py:20-22` | `_coerce()` 是**空实现**，`"10" > 9` 直接 TypeError → 节点失败 |
| G16 | `executors/output.py:13` | `config.get("source") or list(...)[0] if ctx.upstream else None` 结合律歧义：无上游时即使配了 `source` 也返回 None |
| G17 | `contexts.py:30`、`scheduler.py:166`、`useEditorStore.ts:49` | `NodeContext.emit` 与 store 的 `loaded` 都是只写不读的死字段 |
| G18 | `core/security.py:42-43` | 解密失败**静默返回空串** → 表现为 401「鉴权失败」，无法定位是密钥损坏 |
| G19 | `core/config.py:52` | `.env` 用相对路径加载，工作目录一变就失效（打包场景必踩） |
| G20 | `useEditorStore.ts:244` | undo/redo 只按 id 存在性推断 `selectedId`，恢复的 `nodes.selected` 可能指向别的节点 → 画布高亮与右侧面板不一致 |
| G21 | `types.ts:239` + `useEditorStore.ts:168` | 连线只查类型矩阵，不查环、不查入度 → 可造环、可多源灌入单输入节点（靠后端 422 兜底，体验差） |
| G22 | `WorkflowList.tsx:31`、`AppSettings.tsx:38` | 加载只有 try/finally，**无 catch** → 接口失败是空表 + unhandled rejection，无错误态 |
| G23 | `runs/schemas.py:8` | 后端 `RunStatus` 含 `waiting_input`，但引擎从不产生；前端未映射 → 若出现会显示英文原值 |
| G24 | `runs/api/index.ts:13,18,57` | 手写 `WorkflowOption` / `RunListQuery`（违反契约单一事实源）；`?limit=200` 后端无此参数被静默忽略 |
| G25 | `WorkflowList.tsx:121` | 搜索框每敲一个字符发一次请求，无防抖 |
| G26 | `PropertyPanel.tsx:180`、`WorkflowEditor.tsx:444` | 大量原生 `button/input/select`（AGENTS 要求 AntD 5）；多处静态 `message` 未走 `App.useApp()`，不继承主题 |
| G27 | `shared/components/AppLayout.tsx:69` | "打开数据目录"菜单项无 `onClick`，点了没反应 |
| G28 | `templates.ts:181`、`WorkflowList.tsx:49` | 模板的 python→output 未设 `source`（实际取 upstream[0]）；新建工作流不传 description，列表描述列恒空 |
| G29 | `apps/web/package.json:18`、`electron/package.json:12` | `axios` 两个包都声明但全仓未使用（`http.ts` 用 fetch） |
| G30 | `packages/contracts/scripts/check.mjs:30-38`、`generate.mjs:34-44` | 必须真实启动后端；spawn `stdio:'ignore'`、fetch 无超时，后端挂起会让 CI 空挂（叠加 G31） |
| G31 | `ci.yml`、`release.yml:23` | `--frozen-lockfile` 失败后自动回退到无锁安装，掩盖锁漂移；无 `timeout-minutes` / `concurrency` / 依赖缓存 |
| G32 | 仓库根 | 缺 `.gitattributes`：`.editorconfig` 要求 LF，但构建脚本只有 bash（`tools/scripts/*.sh`、`pack: bash ...`），Windows 下 CRLF 直接报错 |
| G33 | `openapi.yaml:247-255`、`packages/contracts/src/index.ts:12-24` | 路径参数 `wf_id` 同时 required + nullable；错误响应（`{code,message,data}`）没有 schema，契约只建模 200 信封 |
| G34 | `electron/main.js:107-153, 137` | IPC handler 在 `loadURL` **之后**注册（renderer 早调用会 "No handler registered"）；dialog 参数由 renderer 原样透传无校验；托盘"打开窗口"每次都 `createWindow()`（多窗口泄漏）；`did-fail-load` 只打日志（白屏无提示）；无 `setWindowOpenHandler` / `will-navigate` / CSP |
| G35 | `apps/web/src/vite-env.d.ts:2`（已修） | 原有一行 `/// <reference types="electron" />`，但 electron 不在 web 依赖里 → 悬空引用。实测不阻断构建（见 B6 撤销说明），属误导性残留；已删除 |

---

## 4. 架构与契约层（建议）

### A1 · 最大的架构缺口：节点配置没有契约

```
modules/workflows/schemas.py:24 → nodes: list[dict] = []   # 无 schema
modules/workflows/schemas.py:48 → graph: dict              # 响应也无 schema
```

后果链条：OpenAPI 里没有节点配置 → 前端无法从 `@agentflow/contracts` 派生 → 只能手写 `WorkflowGraphJSON`（`types.ts:247-258`）+ `config: Record<string, any>`（`types.ts:24`）+ 用 `as any` 提交（`useAutoSave.ts:31`、`WorkflowEditor.tsx:156`、`ModelSettings.tsx:26`）。

这实际上**绕过了 AGENTS §4 的核心意图**（禁止手写前端 API interface）。而节点配置恰恰最需要类型：8 类节点 × 十几个字段 × 前后端各写一遍，字段名漂移是必然的。

**建议**：把 `nodes` 建成 **Pydantic 判别联合**（`type` 为判别键），`GraphDef.nodes: list[NodeDef]`；生成后前端 `NODE_META` / `DEFAULT_CONFIG` / `PropertyPanel` 用 `satisfies` 绑定生成类型。这是一次性投入、长期收益最大的改动，也是 B1（条件分流）与 S2（字段级变量校验）的前置。

### A2 · 其他架构项
- **未知类型降级**（F7）与**手写图类型**（A1）同源，随 A1 一起消失。
- **`core` 反向依赖 `modules`**：`core/providers/__init__.py:14` import `modules.providers.repository`。横切层不应依赖 feature 层；建议把"从 DB 装载 provider"下沉到 `modules/providers/service.py`。
- **错误语言分裂**：`AppException(404, "Workflow not found")` 与中文错误混用且前端原样展示；建议 `code` 给机器、`message` 给用户，错误码枚举进契约（G33）。
- **SSE 事件无契约**：`useRunStream` 里 `data: any`，事件字段全靠约定。建议为 4 种事件定义 TS 类型并放进 `packages/contracts/src/sse.ts`（OpenAPI 不覆盖 SSE，但可以有独立类型文件）。

---

## 5. 桌面化链路（M4 前置风险：占位代码不可用）

| 项 | 证据 | 结论 |
|---|---|---|
| 后端不接受 `--port/--host` | `apps/api/src/app/run.py:9-16` 只读 `settings`；`electron/main.js:71` 却 spawn 带 `--port` | 打包后主进程等一个随机端口，后端却在 8000 → **窗口白屏** |
| `reload=DEBUG`，默认 `True` | `core/config.py:19`、`run.py:14` | 冻结进程里 uvicorn reload 会重跑 `__main__`，onefile 下直接崩 |
| 前端挂载从未连通 | `main.py:19` 按 `__file__` 推算 dist；`MOUNT_FRONTEND` 默认 False 且无人设 true；builder 的 `frontend-dist` 无任何代码引用 | 安装版首页是 JSON/404 |
| exe 路径三方不一致 | `pack-release.sh:17` 写 `electron/resources/`；`electron-builder.yml:25` 从 `apps/api/dist_backend` 拷到 `to: backend`（目录）；`main.js:64` 找 `resourcesPath/backend.exe` | 安装包内找不到后端 |
| PyInstaller spec 是伪格式 | `pyinstaller/backend.spec:1-13`（`[options]`/`entry_points` 是 setup.cfg 语法） | PyInstaller 无法使用；两个构建脚本都绕开它 |
| 单实例锁缺失 | `electron/main.js` 全文无 `requestSingleInstanceLock` | AGENTS §6 未实现；双开两个后端共写同一 SQLite |
| 进程回收不彻底 | `main.js:199-201` 只 `kill('SIGTERM')` 父进程 | onefile 子进程/reload 子进程驻留，占库占端口 |
| 图标缺失 | `electron/icon.ico`、`electron/build/` 都不存在 | `new Tray(不存在路径)` 失败，builder 退回默认图标 |
| 发布配置错位 | `electron-builder.yml:47-50` publish 指向 `agentflow/releases`，实际 remote 是 `polarisz1/AgentFlow`；`main.js:180-183` 更新逻辑仍是注释 | 一旦启用必 404 |

**结论**：M4 不是"补自动更新"，而是"重做打包契约（端口传递 + 数据目录 + exe 路径 + 前端挂载）+ 一项冻结进程技术验证（B5）"。详见 roadmap §5.2。

---

## 6. AGENTS.md 规范符合性

| 约束 | 结论 |
|---|---|
| §2.1 feature 文件集齐 | ✗ `settings` 缺 `repository.py`；`runs`/`providers`/`settings` 缺 `__init__.py` |
| §2.1 禁止跨 feature import repository | ✓ 未发现；但存在 `core → modules` 反向依赖（A2） |
| §2.2 引擎文件齐全 | ✓ 9 个文件 + 8 执行器 |
| §2.3 引擎不直连模型 | ✓ |
| §3.1 前端 feature 内聚 | ✓ 结构规整（跨 feature import 有 2 处，见 F/G 项） |
| §3.2 `shared/` 不反向依赖 features | ✓ |
| §4 禁止手写前端 API interface | ⚠ 响应类型全部来自 contracts，但图/查询/SSE 三处手写（A1、G24） |
| §4 contracts 生成链路 | ✓ 22 路径与后端一致，脚本跨平台可用（本项目最佳实践） |
| §5 ESLint + Prettier | ✗ 配置文件缺失 |
| §6 安全基线 | ⚠ Fernet / WAL / `-I -S` / 路径穿越 / `contextIsolation` 均已实现；**单实例锁缺失**，`DATA_DIR` 位置错误（S13） |
| §7 新增 feature 必须 `alembic revision` | ✗ versions 为空 |
| §8 启动命令可用 | ⚠ `dev:api` 与文档结论冲突（G13）；依赖未安装（G14） |

---

## 7. 文档与实现的偏差（供 roadmap 修订参考）

| roadmap v0.1 声明 | 实际 |
|---|---|
| §1.1 `scheduler.py` ⚠「未实际调 event_bus.publish」 | 已实现（`scheduler.py:172-258`） |
| §1.1 `runs/router.py`「SSE 返回空实现」 | 已实现（`router.py:91-150`），另有 S5/S6 缺陷 |
| §1.1 `pyinstaller/backend.spec` ✓ | 伪格式占位，不可用（§5） |
| §1.1 文件计数「后端 53 .py / 前端 22 文件」 | 实际 58 `.py` / 45 个前端文件 |
| §2 M1 验收 #1「条件…跑通」 | 判定跑通，**分流未实现**（B1） |
| §2 M2 验收 #4「位置拖拽、参数修改均入栈」 | 靠 `onNodeDragStart` / `onFocusCapture` 粗粒度实现；视口不入栈（F1、F9） |
| §2 M2 验收 #5「100 节点压测」 | 未做（文档已自认） |
| §2 M3「变量校验：引用不存在字段 → 报错」 | 只校验源，不校验字段（S2） |
| §2 M3「设置项可配置」 | 三个设置项空转（S8） |
| §3 PRD 追踪表全表 ✗ / ⚠ 骨架 | 与 §2"已完成"自相矛盾，绝大多数已实现 |
| §4「M4 收尾 ✅ Windows 上双击 exe 即用」 | M4 未开始，且当前链路不可用（§5） |
| §1.2「已修复 bug」清单 | 有价值，保留 |

---

## 8. 模块完成度（以代码证据为准）

| 模块 | 完成度 | 依据 / 卡点 |
|---|---|---|
| 契约层 | 85% | 生成/校验链路真实可用；缺节点配置 schema、错误 schema、路径参数类型 |
| 执行引擎 | 75% | 调度/取消/重试/超时/事件/落库齐全；缺条件分流、异常兜底、确定性 merge |
| 节点执行器 | 60% | input/llm/http/output 可用；extract 伪实现、condition 半实现、merge 不确定、python 打包不可用 |
| Provider 适配 | 70% | 结构与错误映射良好；Ollama/Anthropic 各一处真实失效；测试连接不带密钥 |
| 后端 modules | 70% | CRUD/导入导出/运行/SSE 齐全；分层偏差、设置项空转、清理不级联 |
| 前端编辑器 | 70% | 真实可用；缺多选/右键/复制粘贴、视口与选择入撤销、连线环校验、节点专属渲染 |
| 前端运行观测 | 55% | SSE + 列表 + 详情 + 取消 + 重跑齐全；缺 SSE 断线兜底、last_event_id 隔离、waiting_input 映射 |
| 模型设置 | 60% | CRUD 可用；测试连接必失败、启停开关未接、无模型列表拉取 |
| 设置页 | 45% | 基础项 + 导入导出；加载/错误态缺失，多数项不生效 |
| 质量门禁 | 10% | 无测试、无 lint 配置、CI 有假作业 |
| CI | 45% | lint/build/check 三件套在；无测试、无缓存超时、lock 兜底、桌面壳零验证 |
| 数据库 | 40% | 无迁移，靠 create_all + 手写 ALTER |
| 桌面壳 | 45% | 三开关与 preload 白名单达标；单实例/端口协议/进程回收/前端加载/图标均缺 |
| 打包 | 15% | 配置齐全但 exe 名称/路径/distpath/前端资源四处对不上，spec 无效 |

---

## 9. 修复顺序建议（与 roadmap M3.5 对应）

1. **先立网（T1）**：pytest 骨架 + ESLint/Prettier + CI 真跑 + B6 实测。没有网，后面每个修复都不可回归。
2. **再补语义（T2/T3/T4/T5）**：A1 节点契约 → B1 条件分流 → B2 结构化抽取 → S1/S2 校验统一。A1 是 T3/T5 的前置。
3. **修稳定翻车点（T6/T7/T10）**：S3–S12 与 F1–F9。顺序：provider（S4/S9/S10/F5）→ SSE（S5/S6/F6）→ 运行汇总（S11/S12/S3）→ 前端一致性（F1–F4、F7–F9）。
4. **收口工程化（T8/T9）**：alembic baseline（B4）、清理级联（S7）、设置生效（S8）、DATA_DIR（S13）、.gitignore/.gitattributes/README（G11–G14、G32）。
5. **最后动桌面（M4）**：先做前置技术验证（B5、端口/数据目录/dist 注入），验证通过再排期。

---

## 10. 实测修订与实施进度（2026-10-30 晚，环境就绪后）

### 10.1 环境

Node 22.23.4 / pnpm 9.12.0 / Python 3.12.13（uv 管理），全部安装在 **E 盘**，详见 `docs/dev-environment.md`。至此才有了"能跑一次"的条件。

### 10.2 对原报告的修订（保留错误记录，不静默改写）

| 原结论 | 实测结果 | 处置 |
|---|---|---|
| B6：`vite-env.d.ts` 导致 `tsc -b` 失败（P0） | **不成立**：`tsc -b --force` 退出码 0；用假包名做对照实验同样 0 | 撤销 → G35（误导性残留，已删） |
| 隐含前提：CI 的 backend job 会绿 | **红的**：`ruff check` 207 错、`ruff format --check` 52 文件待格式化 | 已修（10.3） |
| contracts:check 可用 | 内容其实一致，但 Windows CRLF 下**逐字节比较**造成假失败 | 已修 `check.mjs`：比较前归一化换行 |
| —（原报告未发现） | S14：根级数组下标 `{{ a[0] }}` 无法解析 | 新增 P1 + xfail 用例 |

### 10.3 T1（测试与门禁）完成情况

| 子任务 | 结果 | 证据 |
|---|---|---|
| T1-a 构建实测 | ✅ | `tsc -b --force` exit 0；`vite build` 成功（3240 modules） |
| T1-b ESLint + Prettier | ✅ | `eslint . --ext ts,tsx --max-warnings=0` → 0；`prettier --check` → All matched files |
| T1-c pytest + 单测 | ✅ | 25 passed / 3 xfailed（xfail 就是 S1/S14/G15 的缺陷台账） |
| T1-d CI 重写 | ✅ | 三个 job 均真跑门禁；加 `timeout-minutes`/`concurrency`/依赖缓存；删除 `--frozen-lockfile` 兜底 |
| 门禁自检 | ✅ | 负向实验：故意写入未使用变量 → lint 退出 1（证明闸门不是空转） |
| 附带修复 | ✅ | `AppException`→`AppError`(N818)、`database.py` 副作用导入改 `import_module`(F811)、`ALLOWED_KEYS`→`allowed_keys`(N806)、`ApiResponse` 改 PEP 695 泛型(UP046，已验证 FastAPI/Pydantic 正常)、新增 `.gitattributes` 统一 LF |
| 未做 | ⏳ | `check.mjs`/`generate.mjs` 仍无 fetch 超时（G30，留到 T9） |

**规模化改动说明**：`ruff format` 重排 56 个 py 文件、Prettier 重排 45 个前端文件，均为纯格式化（`git diff` 复核 + 构建/测试通过），不含逻辑变更。

### 10.4 缺陷处置进度（每完成一项就更新）

| ID | 缺陷 | 状态 | 证据 |
|---|---|---|---|
| B1 | 条件分支无分流 | ✅ 已修 | `0418e31` 调度分流 / `eecc799` 双端口 / `39b01a9` 校验+回归；`test_scheduler_branches`、`test_run_e2e` |
| B2 | 抽取不读 `fields_text` | ✅ 已修 | `fe9aeaf`；`test_extract` 7 条 |
| B3 | 零测试 / 无 lint / CI 假作业 | ✅ 已修 | `2439e09`；用例 0 → 61，ESLint+Prettier 配置，CI 三 job 真跑 |
| B4 | 无 alembic 迁移 | ⬜ T8 | — |
| B5 | Python 节点冻结后不可用 | ⬜ M4 前置验证 | — |
| S1 | `ok` 只等于"无环" | ✅ 已修 | `284995f`：`ok = 无任何问题`、`blocking` 单独给出；前端删掉自建码表 |
| S2 | 变量只校验源 | ✅ 已修 | `284995f`：字段级校验（`UNKNOWN_FIELD`，错误信息列出可用字段） |
| S3 | merge 输入顺序不确定 | ◐ 部分 | `parent_edges` 保序（T3a）；"`all` 校验到达数"未做 |
| S4 | provider 注册表单例竞态 | ⬜ T6 | — |
| S5 | SSE 占请求级 Session | ⬜ T6 | — |
| S6 | 回放事件无 seq | ⬜ T6 | — |
| S7 | 清空运行不删 node_run | ⬜ T8 | — |
| S8 | 三个设置项空转 | ⬜ T8 | — |
| S9 | Ollama `format:"text"` | ⬜ T7 | — |
| S10 | Anthropic JSON 模式无效 | ⬜ T7 | — |
| S11 | 节点异常被吞 | ⬜ T6 | — |
| S12 | 全 skipped 误判 cancelled | ⬜ T6 | — |
| S13 | `DATA_DIR` 少算一层 | ⬜ T8 | — |
| S14 | 根级数组下标不可用 | ⬜ 待排 | `test_resolve_root_level_array_index` 以 xfail 守着 |
| F1–F9 | 前端一致性问题 | ⬜ T10 | — |
| G7 | `wf_id` 可空路径参数 | ✅ 已修 | `f6860cd` |
| G15 | `condition._coerce` 空实现 | ⬜ 待排 | xfail 守着 |
| G35 | `vite-env.d.ts` 悬空类型引用 | ✅ 已修 | `2439e09` |

---

## 附录 A · 验证边界（2026-10-30 修订）

- 本次评审为**只读**；后续修复在 T1 范围内单独提交，未改动业务逻辑。
- 环境已就绪（见 §10.1），`tsc / vite / pytest / ruff / eslint / contracts:check` 均已**实跑**。仍**未**覆盖：真实 provider 联调、100 节点性能、打包链路（M4）。
- 本机 Python 为 3.10，但后端一律通过 `uv run`（3.12.13 venv）执行，未污染系统解释器。
- `docs/*.html`（PRD / 设计稿 / UI 稿）是 HTML，评审通过 roadmap 的转述引用；若与原文有出入，以 HTML 为准。

## 附录 B · 未覆盖

- 未做运行时验证、100 节点性能实测、真实 provider 联调。
- `docs/ui-design/index.html` 与实现的逐屏一致性未核对。
- 未审计第三方依赖的漏洞与许可证。
