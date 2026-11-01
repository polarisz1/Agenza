# AgentFlow 待办清单（更新于 2026-11-01 收尾）

> 只记录**已经确认要延后**的事项，避免它们散落在对话里。
> 每项都写了当前证据与触发条件；做完一项就划掉并在提交信息里引用条目号。
>
> **2026-11-01 收尾说明**：B/C 两组（v0.1 工程质量缺口与评审 P2 遗留）已逐项修复并验证，
> 证据见 `docs/code-review-2026-11-01.md` 的验证矩阵。仍留在表里的只剩
> **依赖外部条件**的 A 组（证书、发行渠道、图标素材、远端首跑）。

## A. 发布与分发（用户确认延后）

| ID | 项 | 现状证据 | 前置条件 |
|---|---|---|---|
| A1 | exe 图标与版本信息 | **代码侧已就绪**：<br>· 图标只认 `electron/build/icon.ico`（electron-builder `buildResources: build`）<br>· `electron-builder.yml` 把 `build/icon.ico` 打进 asar，托盘用同一张图（`main.js::setupTray`）<br>· 缺失时 builder 退回默认图标、壳跳过托盘，不影响启动<br>**仍缺**：一张 256×256 的 `icon.ico` 素材 | 设计提供 256×256 `icon.ico`，放到 `electron/build/icon.ico` 即可生效（无需改代码） |
| A2 | 代码签名 | 无证书；首次安装会有 SmartScreen 提示 | 需要代码签名证书（EV 或 OV） |
| A3 | 自动更新 | `D-4` 定案：v1 不做；`electron-updater` 已在 devDependencies 但未接线。<br>本轮移除了 electron-builder 里写错的 `publish`（owner/repo 与实际仓库不符，一旦启用必 404） | 需要 Release feed + 签名（A2） |
| A4 | 前端热更 | 后端托管 dist，换目录 + reload 即可，但没做管理界面 | 依赖 A3 的更新通道 |
| A5 | CI 远端首跑 | `ci.yml` / `release.yml` 只在本地验证过 YAML 与命令，从未 push 到 GitHub 真跑。<br>**本轮新增的 `e2e` / `security` job、可复用桌面工作流同样只做了本地 YAML 解析校验** | 推一次仓库即可（这是唯一无法在本机闭环的项） |

## B. 工程质量缺口（全部闭环）

| ID | 项 | 结果 | 证据 |
|---|---|---|---|
| B1 | 100 节点性能基线 | ✅ 已建立自动化基线：拖拽 **62.6fps**、运行期长任务 **0**、后端 100 节点调度 **4ms**；阈值 30fps / 1000ms / 5s 进 CI | `e2e/perf100.spec.ts`、`apps/api/tests/test_scheduler_scale.py`、`docs/v0.1-perf-baseline.md` |
| B2 | 依赖漏洞 / 许可证审计 | ✅ `pnpm audit --prod`、`pip-audit` 实跑并记录；JS 98 个生产包全为 MIT/ISC/BSD-3；Python 33 个运行时包无已知漏洞；react-router 2 个 moderate 已评估接受（SPA + 本地固定路由，附升级触发条件）；新增 `audit:js` / `audit:py` 与 CI 周检 | `docs/dependency-audit-2026-11-01.md`、`tools/scripts/audit-python.mjs`、`.github/workflows/ci.yml` `security` job |
| B3 | E2E 进 PR 级 CI | ✅ 新增 `e2e` job：pnpm install → uv sync → Chromium → `pnpm e2e`（含 100 节点性能用例），失败上传 trace | `.github/workflows/ci.yml` |
| B4 | 契约兼容性检查 | ✅ 新增"基线 vs 当前"破坏性变更检测（自研无依赖规则集 + 10 条单测）：移除路径/字段、请求新增必填、枚举收窄、operationId 变化等；基线在发版时用 `pnpm contracts:baseline` 刷新 | `packages/contracts/scripts/{compat,compat-rules,lib}.mjs`、`packages/contracts/baseline/openapi.yaml`、CI `contracts` job |
| B5 | 桌面冒烟进 PR 级 CI | ✅ 构建+冒烟抽成可复用工作流；发布流水线复用同一份；PR 打 `desktop-smoke` label 或手动触发即可跑完整安装包链路（约 40 分钟，按需触发） | `.github/workflows/desktop-build-smoke.yml`、`desktop-smoke-pr.yml`、`release.yml` |

## C. 评审 P2 遗留（12 条，全部闭环）

> 更正：此前口头说过"P2 全部闭环"，**不准确**。P2 共 35 条，实际闭环 23 条，下面 12 条仍未做。
> 本轮已全部处理；G31 仅剩"远端没真跑过"，并入 A5。

| ID | 项 | 结果 | 证据 |
|---|---|---|---|
| G5 | 双运行入口 | ✅ `POST /api/runs` 标 `deprecated: true`，描述指向 `POST /api/workflows/{wf_id}/runs` | `runs/router.py`、`openapi.yaml`、`tests/test_contract_shape.py` |
| G17 | 死字段 | ✅ 删除 `NodeContext.emit`、store 的 `loaded`（含测试夹具） | `core/engine/contexts.py`、`scheduler.py`、`useEditorStore.ts` |
| G19 | `.env` 相对路径 | ✅ 改为绝对路径 `apps/api/.env`（cwd `.env` 仅作低优先级兜底）；测试断言绝对路径与优先级 | `core/config.py`、`tests/test_contract_shape.py` |
| G20 | undo 后选中不一致 | ✅ 撤销快照包含 `selectedId`，undo/redo 按快照还原（不再按 id 存在性推断） | `useEditorStore.ts`、`editorSemantics.test.ts` |
| G21 | 连线不查环/入度 | ✅ 新增 `connectionIssue`：类型矩阵 + 入度（merge 除外单输入）+ 环检测 + 条件端口约束；store 与画布共用同一判定 | `types.ts`、`useEditorStore.ts`、`WorkflowEditor.tsx`、`editorSemantics.test.ts` |
| G23 | `waiting_input` 未映射 | ✅ 前端运行列表/详情加中文映射与筛选项；后端枚举注释说明它是人工确认预留态（D 组范围外） | `RunList.tsx`、`RunDetail.tsx`、`runs/schemas.py` |
| G24 | 前端手写类型 | ✅ `WorkflowOption` 从 `WorkflowListItem` 派生；`RunListQuery` 用新增的 `ApiQuery<路径, 方法>` 直接取契约；去掉被后端忽略的 `?limit=200` | `packages/contracts/src/index.ts`、`runs/api/index.ts` |
| G26 | 原生控件 / 静态 message | ✅ PropertyPanel 的 6 处原生 `<button>` 换成 AntD（Button / Segmented / Switch）；全仓 9 个组件改为 `App.useApp()` 的 message（继承主题与语言） | `PropertyPanel.tsx`、`WorkflowEditor.tsx`、`RunList.tsx`、`RunDetail.tsx`、`WorkflowList.tsx`、`ModelSettings.tsx`、`AppSettings.tsx`、`RunInputsModal.tsx`、`AppLayout.tsx` |
| G28 | 模板/新建细节 | ✅ python 模板输出节点显式 `source`；模板创建落库 description；新增"工作流信息→描述"编辑入口（未选中节点时）；列表描述列空值显示 `—` | `templates.ts`、`WorkflowList.tsx`、`PropertyPanel.tsx`、`useEditorStore.ts`、`useAutoSave.ts` |
| G30 | 契约脚本超时 | ✅ `fetch` 单次 5s + 总预算 45s，`execFileSync` 120s 兜底；同时修复 Windows 下 Python 读 stdin 的编码乱码（改为临时文件 + `PYTHONUTF8`） | `packages/contracts/scripts/generate.mjs`、`check.mjs`、`lib.mjs` |
| G31 | CI 锁与缓存 | ✅ 已是严格 `--frozen-lockfile`、有 `timeout-minutes` 与缓存；仅剩"远端没真跑过"→ 并入 **A5** | `.github/workflows/ci.yml` |
| G33 | 契约建模缺口 | ✅ 新增 `ErrorResponse` 并挂到 4 个 router 的 400/404/409/500（422 保留 FastAPI 校验形状）；`wf_id` 早已是非可空路径参数，本轮加测试锁定 | `core/response.py`、`modules/*/router.py`、`openapi.yaml`、`tests/test_contract_shape.py` |

## D. 明确不在 v0.1 / v0.2 范围

定时触发（`apscheduler` 已移除，要用需重新加）、版本历史、子工作流、人工确认、本地 RAG、成本展示（`D-7` 维持不做）。

## E. 本轮新增的工程改进（顺手修，不单独立项）

| 项 | 原因 | 证据 |
|---|---|---|
| v0.1.1 热修：reload 下 Python 节点失败 + 空错误 | uvicorn reload 在 Windows 用 SelectorEventLoop，`create_subprocess_exec` 抛空消息 NotImplementedError，开发态脚本节点必失败 | `core/engine/errors.py`、`executors/python.py` 线程降级；9 条新用例；177 passed |
| 契约生成中文乱码 | Windows 下 Python 从 stdin 按 cp936 解码 UTF-8 JSON，导致 openapi.yaml/generated TS 里的中文描述变乱码 | `generate.mjs`（临时文件 + `PYTHONUTF8`），重生成后 `contracts:check` 通过 |
| `core/providers` 反向依赖 `modules` | 评审 §4 A2：横切层不得依赖 feature 层 | 装载逻辑下沉到 `modules/providers/service.py::build_registry`，`core/providers/__init__.py` 只留适配器 |
| 后端日志在壳里乱码 | 壳按 UTF-8 解 stdout，而 Python 在 Windows 默认 cp936 | `electron/main.js` spawn 注入 `PYTHONUTF8`/`PYTHONIOENCODING`；`dev.mjs` 同步 |
| `loadURL` 失败白屏 | `did-fail-load` 只打日志 | `main.js` 捕获 loadURL reject，给出 重试/日志/退出 对话框 |
| 服务商页无错误态 | 与 G22 同类的"接口失败=空表" | `ModelSettings.tsx` 补 Alert + 重试；复制/删除/保存失败补 catch+message |
| `updateSettings` 使用响应类型 | 会把只读字段（data_dir/app_version）一起提交 | 改用契约里的 `SettingsUpdate` |
| 打包脚本与发布流水线不一致 | `pack-release.sh` 用 `npm install`，流水线用 `npm ci` | 统一为 `npm ci && npx electron-builder --win nsis --x64` |
| electron-builder `publish` 指向错误仓库 | 一旦执行 `--publish` 必 404 | 删除该段并注明自动更新由 D-4 定案不做 |
