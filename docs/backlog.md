# AgentFlow 待办清单（截至 2026-11-01）

> 只记录**已经确认要延后**的事项，避免它们散落在对话里。
> 每项都写了当前证据与触发条件；做完一项就划掉并在提交信息里引用条目号。

## A. 发布与分发（用户确认延后）

| ID | 项 | 现状证据 | 前置条件 |
|---|---|---|---|
| A1 | exe 图标与版本信息 | 打包用 `--config.win.signAndEditExecutable=false` 跳过 rcedit；`electron/build/icon.ico` 不存在（托盘也因此跳过） | 需要一张 256×256 的 `icon.ico` |
| A2 | 代码签名 | 无证书；首次安装会有 SmartScreen 提示 | 需要代码签名证书（EV 或 OV） |
| A3 | 自动更新 | `D-4` 定案：v1 不做；`electron-updater` 已在 devDependencies 但未接线 | 需要 Release feed + 签名（A2） |
| A4 | 前端热更 | 后端托管 dist，换目录 + reload 即可，但没做管理界面 | 依赖 A3 的更新通道 |
| A5 | CI 远端首跑 | `ci.yml` / `release.yml` 只在本地验证过 YAML 与命令，从未 push 到 GitHub 真跑 | 推一次仓库即可 |

## B. 工程质量缺口

| ID | 项 | 说明 |
|---|---|---|
| B1 | 100 节点性能基线 | M2 遗留，从未压测；目标：拖拽 ≥30fps、运行不阻塞 UI |
| B2 | 依赖漏洞 / 许可证审计 | 评审 §9 明确"未审计"；`pnpm audit` / `pip-audit` 都没跑过 |
| B3 | E2E 进 PR 级 CI | `e2e/` 目前只在本地跑；PR 级跑需要装 Playwright + 构建 dist（约 +3 分钟） |
| B4 | 契约兼容性检查 | `D-6`：只有漂移检查，没有破坏性变更检测（openapi-diff） |
| B5 | 桌面冒烟进 PR 级 CI | `desktop-smoke` 现在只在 `release.yml`（tag / 手动触发），PR 级跑代价约 45 分钟 |

## C. 评审 P2 尚未处理（12 条）

> 更正：此前口头说过"P2 全部闭环"，**不准确**。P2 共 35 条，实际闭环 23 条，下面 12 条仍未做。
> 已闭环：G1 G2 G3 G4 G6 G7 G8 G9 G10 G11 G12 G13 G14 G15 G16 G18 G22 G25 G27 G29 G32 G34 G35。

| ID | 项 | 证据 |
|---|---|---|
| G5 | 双运行入口 | `POST /api/runs`（`runs/router.py:55`）与 `POST /api/workflows/{id}/runs`（`workflows/router.py:121`）并存；D-2 建议标 deprecated 但未做 |
| G17 | 死字段 | `NodeContext.emit`、store 的 `loaded` 只写不读 |
| G19 | `.env` 相对路径 | `config.py` 仍 `env_file=".env"`（相对 cwd） |
| G20 | undo 后选中不一致 | `useEditorStore.ts` 的 undo/redo 只按 id 存在性推断 `selectedId` |
| G21 | 连线不查环/入度 | 前端仍只查类型矩阵（无 `hasCycle`/入度校验），靠后端 422 兜底 |
| G23 | `waiting_input` 未映射 | 后端枚举里有、引擎从不产生、前端无中文映射 |
| G24 | 前端手写类型 | `runs/api/index.ts:13,18` 的 `WorkflowOption` / `RunListQuery` |
| G26 | 原生控件替代 AntD | `PropertyPanel.tsx` 仍有 6 处原生 `<button>`；静态 `message` 未走 `App.useApp()` |
| G28 | 模板/新建细节 | `templates.ts` 的 python→output 未设 `source`；新建工作流不传 description（列表描述列恒空） |
| G30 | 契约脚本超时 | `check.mjs` / `generate.mjs` spawn 后端时无 fetch 超时，后端挂起会让 CI 空挂 |
| G31 | CI 锁与缓存 | `release.yml` 与 `ci.yml` 都已是严格 `--frozen-lockfile`、有 `timeout-minutes` 与依赖缓存；**仅剩"远端没真跑过"这一项**（并入 A5） |
| G33 | 契约建模缺口 | 路径参数 `wf_id` 同时 required + nullable；错误响应 `{code,message,data}` 没有 schema |

## D. 明确不在 v0.1 / v0.2 范围

定时触发（`apscheduler` 已移除，要用需重新加）、版本历史、子工作流、人工确认、本地 RAG、成本展示（`D-7` 维持不做）。
