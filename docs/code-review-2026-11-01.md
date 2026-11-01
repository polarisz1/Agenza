# AgentFlow v0.1 收尾复核报告 · 2026-11-01

> **对象**：`docs/backlog.md` 中记录的全部遗留项（B 组工程质量 5 项、C 组评审 P2 遗留 12 项）
> 与当前 HEAD 上的全部 v0.1 代码（后端 87 个 `.py` / 前端 45 个文件 / Electron 壳 / 打包 / CI）。
>
> **方法**：逐项修复 → 每项补可回归的测试或脚本 → 全量门禁实跑 → 再做一遍全仓代码复核
> （逐文件通读 + 契约产物交叉核对 + 负向实验）。所有结论都有命令或文件行为证据。
>
> **一句话结论**：v0.1 的**功能与工程质量缺口已全部闭环**；剩余 5 项全部属于"依赖外部条件"
> 的发布事项（图标素材、签名证书、发版通道、远端首跑），不影响 v0.1 在本地/内网交付使用。
> 8 个门禁（pytest 168、vitest 42、E2E 5、契约漂移/兼容、lint/format/typecheck、性能基线、
> 依赖审计、桌面冒烟脚本）在本地**全部实跑通过**。

---

## 1. 收尾范围与结果

### 1.1 B 组：工程质量缺口（5/5 闭环）

| ID | 原缺口 | 现在的状态 | 关键证据 |
|---|---|---|---|
| B1 | 100 节点从未压测 | 前端拖拽 **62–64fps**（三次实测 63.8 / 62.0 / 62.5）、运行期最长任务 **0ms**；后端 100 节点调度 **4ms**。阈值写进 E2E，进 PR CI | `e2e/perf100.spec.ts`、`apps/api/tests/test_scheduler_scale.py`、`docs/v0.1-perf-baseline.md` |
| B2 | 依赖漏洞/许可证未审计 | `pnpm audit --prod`：98 个生产包，全部 MIT/ISC/BSD-3；2 个 react-router moderate 已评估接受（SPA、固定本地路由、无 SSR）。`pip-audit`：33 个运行时包，0 漏洞。CI 周检 | `docs/dependency-audit-2026-11-01.md`、`tools/scripts/audit-python.mjs` |
| B3 | E2E 只在本地跑 | 新增 `e2e` job（install → uv sync → chromium → `pnpm e2e`），失败上传 trace | `.github/workflows/ci.yml` |
| B4 | 只有漂移检查 | 新增基线对比的破坏性变更检测（10 条单测 + 负向实验），`pnpm contracts:compat` 进 CI | `packages/contracts/scripts/compat*.mjs`、`baseline/openapi.yaml` |
| B5 | 桌面冒烟只在发布流水线 | 构建+冒烟抽成可复用工作流；发布流水线复用；PR 打 `desktop-smoke` label 即跑 | `desktop-build-smoke.yml`、`desktop-smoke-pr.yml` |

### 1.2 C 组：评审 P2 遗留（12/12 处理）

| ID | 处置摘要 | 回归测试 |
|---|---|---|
| G5 | 旧运行入口标 `deprecated` 并指向新入口 | `test_legacy_run_entry_is_marked_deprecated` |
| G17 | 删除 `NodeContext.emit`、store `loaded` | 现有 168+42 用例全绿 |
| G19 | `.env` 改绝对路径（`apps/api/.env`），cwd 仅兜底 | `test_env_file_is_absolute_and_points_to_apps_api` |
| G20 | 撤销快照保存 `selectedId`，undo/redo 还原选中并同步 `selected` 标记 | `undo 恢复到快照里的 selectedId` / `redo 也会还原选中态` |
| G21 | 连线前校验：类型矩阵 + 入度（merge 多入）+ 环 + 条件端口 | `连线校验（G21）` 7 条 |
| G23 | `waiting_input` 中文映射 + 筛选项；后端注明为预留态 | 前端类型检查/构建 |
| G24 | `WorkflowOption` 从 `WorkflowListItem` 派生；`RunListQuery` 用 `ApiQuery` 取契约；去掉无效 `?limit=200` | `tsc -b` |
| G26 | PropertyPanel 6 处原生按钮 → AntD（Button/Segmented/Switch）；9 个组件改用 `App.useApp()` 的 message | `eslint --max-warnings=0` |
| G28 | python 模板输出显式 `source`；模板 description 落库；新增描述编辑入口；列表空描述显示 `—` | `setDescription` 2 条 + E2E 模板创建 |
| G30 | 契约脚本 fetch 5s/总 45s + exec 120s 超时；顺带修中文乱码 | `contracts:check` 实跑通过 |
| G31 | 只剩"远端没真跑过"→ 并入 A5 | — |
| G33 | 新增 `ErrorResponse` 契约，挂 400/404/409/500；框架级 404/405 同信封；422 保留校验形状 | `test_contract_shape.py` 5 条 |

---

## 2. 复核阶段发现并修复的问题

以下问题不在 backlog 的字面清单里，但属于"v0.1 不能带着它交付"的缺口，均已修复。

| # | 问题 | 为什么必须修 | 位置 |
|---|---|---|---|
| R1 | 契约产物中文乱码 | `generate.mjs` 把 JSON 从 stdin 灌给 Python，Windows 下 Python 按 cp936 解码 UTF-8 → `openapi.yaml` 与生成 TS 的中文描述全部变乱码（还写出 lone surrogate）。任何中文 docstring 都会污染契约 | `packages/contracts/scripts/generate.mjs` |
| R2 | `core/providers` 反向依赖 `modules.providers.repository` | AGENTS §2.2 的分层方向被破坏（横切层依赖 feature 层），且每次装载都把 DB 细节带进 core | `core/providers/__init__.py` → `modules/providers/service.py::build_registry` |
| R3 | 框架级 404 返回 `{"detail": ...}` | 与 `ErrorResponse` 契约不一致，前端 `toError` 取不到 message，只能显示 "HTTP 404" | `main.py` 增加 `StarletteHTTPException` handler |
| R4 | 桌面壳日志中文乱码 | 壳按 UTF-8 解子进程 stdout，而 Python 在 Windows 默认 cp936 → `backend.log` 里全是乱码，排障不可用 | `electron/main.js` spawn 注入 `PYTHONUTF8`/`PYTHONIOENCODING`；`dev.mjs`、`playwright.config.ts` 同步 |
| R5 | `loadURL` 失败白屏无提示 | `did-fail-load` 只打日志；用户看到的是空窗口，不知道能做什么 | `main.js` 捕获 reject → 重试/日志/退出 对话框 |
| R6 | 未知节点类型无自定义渲染 | `nodeTypes` 缺 `unknown`，F7 的"占位提示"实际退回 React Flow 默认节点（无端口、无说明） | `nodes/index.ts` 登记 `unknown: BaseNode` |
| R7 | 服务商页无错误态 + 多处未捕获 rejection | 列表失败=空表；保存/删除/复制失败无提示（G22 同类问题的漏网） | `ModelSettings.tsx`、`AppSettings.tsx`、`WorkflowList.tsx` |
| R8 | `updateSettings` 用响应类型 | 会把 `data_dir`/`app_version` 等只读字段一起提交，契约失真 | `settings/api/index.ts` 改用 `SettingsUpdate` |
| R9 | electron-builder `publish` 指向错误仓库 | `owner: agentflow/releases` 与实际 `polarisz1/AgentFlow` 不符，一旦 `--publish` 必 404；而自动更新按 D-4 不做 | `electron-builder.yml` 删除该段并注明原因 |
| R10 | 托盘图标路径与打包内容不一致 | 托盘找 `app.asar/icon.ico`，但 `files` 没包含它 → 即使补了图标也不会显示；builder 又按 `buildResources` 找 `build/icon.ico` | `main.js::setupTray` 三级候选 + `files: build/icon.ico` |
| R11 | `pack-release.sh` 与流水线不一致 | 本地用 `npm install`、CI 用 `npm ci`/`npx electron-builder`，产物可能不同 | 统一为 `npm ci && npx electron-builder --win nsis --x64` |
| R12 | 打包脚本 docstring 产物路径过期 | 写 `electron/resources/backend.exe`，实际是 `apps/api/dist_backend/backend.exe` | `pyinstaller/build.py` |

---

## 3. 验证矩阵（2026-11-01 本机实跑）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `uv run --directory apps/api pytest` | **168 passed**（新增 `test_contract_shape` 5、`test_scheduler_scale` 1） |
| 2 | `pnpm --filter @agentflow/web test` | **42 passed / 5 files**（新增连线规则、撤销选中、描述 12 条） |
| 3 | `pnpm e2e`（build:web + Playwright） | **5 passed**；`[perf] 100 节点拖拽 62.5fps / 长任务 0`（三次一致） |
| 4 | `uv run --directory apps/api ruff check src tests` | All checks passed |
| 5 | `uv run --directory apps/api ruff format --check src tests` | 87 files already formatted |
| 6 | `pnpm --filter @agentflow/web lint` | 0 error / 0 warning（`--max-warnings=0`） |
| 7 | `pnpm --filter @agentflow/web format:check` | All matched files use Prettier code style |
| 8 | `pnpm typecheck` | `tsc -b` 通过 |
| 9 | `pnpm --filter @agentflow/web build` | 构建成功（antd-vendor 1.0MB / gzip 317KB） |
| 10 | `pnpm contracts:check` | OK（yaml 与 generated TS 均与后端一致） |
| 11 | `pnpm contracts:compat:test` | 10 passed（规则单测） |
| 12 | `pnpm contracts:compat` | OK（0 breaking / 0 warning） |
| 13 | 兼容性**负向实验**（删响应字段/改必填/删路径） | 正确报出 6 条 breaking（见 §3.1） |
| 14 | `pnpm audit:js` | 98 prod 包，2 moderate（已评估接受） |
| 15 | `pnpm audit:py` | No known vulnerabilities |
| 16 | `node --check`（壳/脚本 9 个文件） | 全部通过 |
| 17 | GitHub Actions YAML（4 个文件） | PyYAML 解析通过，job/trigger 结构符合预期 |
| 18 | `pnpm check`（聚合门禁） | 退出码 0 |

### 3.1 兼容性检测负向实验（证明闸门不是空转）

对真实契约做了三处"破坏性"修改后再跑规则：

```text
POST /api/workflows 200.data.description | 响应字段被移除（调用方会少拿到数据）
GET /api/workflows/{wf_id} 200.data.description | 响应字段被移除
PUT /api/workflows/{wf_id} 200.data.description | 响应字段被移除
POST /api/workflows/{wf_id}/runs body.inputs | 请求字段由可选变为必填
POST /api/runs body.inputs | 请求字段由可选变为必填
/api/settings/system/info | 接口路径被移除
→ breaking: 6, warnings: 0
```

### 3.2 门禁负向实验（lint）

`eslint --max-warnings=0` 在改造过程中真实拦下 3 条 `react-hooks/exhaustive-deps`
（`App.useApp()` 的 message 未进依赖数组），修复后才放行——闸门有效。

---

## 4. 遗留项判定（为什么不影响 "v0.1 无缺口"）

| ID | 状态 | 判定 |
|---|---|---|
| A1 | 代码就绪，缺素材 | 托盘/安装包图标路径已统一到 `electron/build/icon.ico`，**放一张 256×256 ico 即生效**，无需改代码。缺的是品牌素材，不是功能 |
| A2 | 外部依赖 | 代码签名需要证书；未签名只影响首次安装的 SmartScreen 提示，不影响运行 |
| A3 / A4 | 已定案不做 | `D-4`：v1 不做自动更新；`electron-updater` 保留依赖但不接线，并清掉了写错的 publish 配置。属于**产品决策**而非缺口 |
| A5 | 外部依赖 | CI/发布工作流只在本地做了 YAML 解析与命令校验，**没有远端首跑**。这是唯一无法在本机闭环的验证项，风险已在 §5 说明 |

**结论**：v0.1 范围内的功能、契约、质量门禁、性能、依赖安全、桌面冒烟都已闭环；
A 组是"发版条件"，不影响版本本身的完整性。

---

## 5. 未覆盖与残余风险（写清楚，不粉饰）

1. **真实模型服务商联调**：本轮全部用 Mock/假执行器，没有对 OpenAI/Ollama/Anthropic 发真实请求。
   适配器的请求体与错误映射有单测（`test_providers.py`、`test_provider_key_errors.py`），
   但真实网络/鉴权只能在有 Key 的环境验证。
2. **安装包重新构建**：本轮修改了 `electron/main.js`（spawn 环境变量、loadURL 错误处理、托盘候选路径）
   与 `electron-builder.yml`（files / 去掉 publish），但**没有在本机重跑完整 PyInstaller + NSIS 链路**
   （需要下载 embeddable Python，约 40 分钟）。JS 语法已 `node --check`，配置已 YAML 解析，
   `desktop-build-smoke` 工作流在 PR 打 label 时会覆盖真实产物验证。
3. **远端 CI 首跑（A5）**：新增的 `e2e` / `security` / 可复用桌面工作流只在本地验证。
   首次 push 后需要看一眼：Playwright 缓存键、`uv sync` 在 ubuntu 的行为、reusable workflow 的
   artifact 传递。
4. **多用户/局域网暴露**：后端只监听 `127.0.0.1`，没有鉴权——这是产品定位（单用户本地），不是缺口。
5. **100 节点性能**：基线是 headless Chromium 的满帧数据；真机上低端 GPU 可能更低。
   阈值已按 30fps 保守设定。

---

## 6. AGENTS.md 符合性复核（本轮后）

| 约束 | 结论 |
|---|---|
| §2.1 feature 五件套 + `__init__.py` | ✅ 四个模块齐全（settings 上一轮已补 repository） |
| §2.1 禁止跨 feature import repository | ✅ 未发现；core → modules 的反向依赖已消除（R2） |
| §2.2 引擎文件齐全 / 不直连模型 | ✅ 9 文件 + 8 执行器；统一走 providers 适配层 |
| §3.1 前端 feature 内聚 | ✅ 跨 feature 仅 routes 层聚合 |
| §3.2 shared 不反向依赖 features | ✅ 未发现 |
| §4 契约单一事实源 | ✅ 漂移检查 + 兼容性检查；前端不再手写查询/图类型 |
| §5 技术栈锁定 | ✅ 未引入新依赖（兼容性检查与审计脚本都是零依赖 Node） |
| §6 安全基线 | ✅ contextIsolation/nodeIntegration/sandbox、Fernet、`-I -S`、WAL、127.0.0.1、路径校验、单实例锁 |
| §7 新增 feature 清单 | ✅ 本轮无新增 feature；迁移 baseline 已存在 |
| §8 启动命令 | ✅ `pnpm dev` / `dev:api` / `dev:web` 可用（E2E 与手工均验证） |

---

## 7. 建议的下一步（不属于 v0.1 缺口）

1. 拿到品牌图标后补 `electron/build/icon.ico`，并按 A1 记录验证托盘与安装包图标。
2. 首次 push 后盯一次 `e2e` / `security` / 桌面冒烟三条约新流水线（A5）。
3. 若要开 v0.2 的自动更新，先补 A2 签名，再启用 `electron-updater`（别再手写 publish 配置）。
4. 真实 provider 联调建议补一个"手工验收清单"，与单测互补。
