# M4 前置技术验证记录

> 目的：在动 M4 产品代码前，用最小实验回答三个"可能推翻方案"的问题。
> 每个实验都在 `.tmp/` 下做，不进主干代码。

## ① 冻结进程能否跑 Python 脚本节点 —— **通过（方案 A 可行）**

**做法**：用 PyInstaller 6.22.3 打一个 onedir 的 `spike.exe`，里面做两件事：
把 `sys.executable` 当解释器 spawn 一次（复现故障），再用随包内置的
embeddable CPython（`--add-data pyemb;pyemb`）跑同一个 runner（验证修法）。

**实测输出**（2026-10-31）：

```
[parent] frozen=True
[parent] sys.executable=E:\...\.tmp\spike-py\dist\spike\spike.exe
[parent] meipass=E:\...\dist\spike\_internal
[spawn-sysexec] rc=0 stdout='[parent] frozen=True ...'      ← 又跑了一遍后端自己
[emb] exists=True path=...\_internal\pyemb\python.exe
[spawn-emb] rc=0 stderr=''
[result] {"echo": "中文内容", "python": "3.12.10",
          "exe": "E:\\...\\_internal\\pyemb\\python.exe"}
```

**结论**：
1. 评审 B5 复现成立：冻结后 `sys.executable` 就是 `backend.exe`，用它 spawn 等于**再起一个后端**（输出是父进程自己的 banner，而不是用户脚本）。
2. 修法可行：内置 embeddable CPython（`python-3.12.10-embed-amd64.zip`，10.6MB 压缩 / 21.5MB 解压）放在 `_internal\pyemb\`，用 `-I -S` 跑 runner，中文往返正常，脚本里的 `sys.executable` 指向内置解释器、不会递归。
3. `-I -S` 确实屏蔽 site-packages（`import httpx` 报 `ModuleNotFoundError`），与"脚本只用标准库"的现有隔离语义一致。

**代价（实测）**：onedir 产物 49.5MB，其中内置解释器 21.5MB；热启动约 0.6s。

**由此确定的实现约束**：
- 打包用 **onedir**，不用 onefile（onefile 每次启动要解压，且要写系统 TEMP）
- onefile 若必须用，需 `--runtime-tmpdir` 指向用户数据目录（本次在受限环境里正是卡在"往 TEMP 解压 DLL 被拒"）
- 运行时用 `--resource-dir`（或等价参数）定位 `pyemb/python.exe`，不要依赖 `sys._MEIPASS` 之外的推算
- runner 读脚本建议 `encoding='utf-8-sig'`（容忍 BOM；本次调试中带 BOM 的脚本会直接 `SyntaxError`）

**D-5 定案**：选方案 A（随包内置 embeddable CPython），不选"要求用户自备 Python"，也不砍脚本节点。

### D-5 落地（已实现）

`core/engine/executors/python.py` 不再直接用 `sys.executable`，改为 `resolve_python_bin()`：

| 优先级 | 来源 | 场景 |
|---|---|---|
| 1 | `PYTHON_BIN` 环境变量 | 运维/调试，或本地验证打包效果 |
| 2 | `<resource-dir>/pyemb/python.exe` | **打包态唯一正确来源** |
| 3 | 当前进程解释器 | 开发态（venv） |

打包态若找不到内置解释器，节点直接返回可读错误（"请在打包时把 embeddable CPython 放进
resources/pyemb/"），**绝不退回 `sys.executable`**——那等于再起一个后端。

顺带把 runner 读脚本改成 `utf-8-sig`：带 BOM 的脚本（记事本/PowerShell 另存常见）
以前会 `SyntaxError: invalid non-printable character U+FEFF`。

实测（宿主是 venv 3.12.13，脚本跑在随包 3.12.10 上）：

```
settings.PYTHON_BIN = ...\.tmp\spike-py\pyemb\python.exe
当前进程解释器      = ...\apps\api\.venv\Scripts\python.exe
output: {'exe': '...\pyemb\python.exe', 'ver': '3.12.10'}
用了 PYTHON_BIN 指定的解释器: True
```

## ② 端口 / 数据目录 / 前端 dist / 迁移目录的注入 —— **已完成**

**做法**：新增 `apps/api/src/app/run.py` 作为唯一启动入口（argparse → 写环境 → 再 import app），
`Settings` 增加 `RESOURCE_DIR` 与三个派生路径（`frontend_dist` / `alembic_ini` / `alembic_dir`），
`main.py` 与 `db/database.py` 不再用 `__file__` 推算。

优先级：**命令行 > 环境变量 > 默认值**；冻结环境下 `reload` 强制关闭、`MOUNT_FRONTEND` 默认开启。

**验证**（模拟打包布局：`.tmp/m4-res/` 里放 `frontend-dist/` + `alembic/` + `alembic.ini`）：

```
启动：python -m app.run --host 127.0.0.1 --port 8021 \
        --data-dir <repo>/.tmp/m4-data --resource-dir <repo>/.tmp/m4-res --mount-frontend

/health          → {"status":"ok"}
/                → 200，返回注入目录里的 index.html（<div id="root"> 命中）
/workflows       → 200，SPA 回退到同一 index.html
/api/workflows   → 200（API 不受影响）
数据目录          → 注入的 .tmp/m4-data/agentflow.db 被创建
迁移              → 表齐全 + alembic_version = 0001（说明用的是注入的 alembic 目录）
```

回归：全量 132 passed（新增 15 条覆盖优先级/reload 关闭/资源目录回退/mount 开关），
`pnpm check` exit 0，Playwright 4 条用例仍全绿（E2E 走的就是"env 注入启动"这条路）。

**顺带**：`run.py` 无参数运行时行为与改造前一致（`pnpm dev:api` 不受影响）。

## ③ 前端产物由谁托管 —— 后端托管（已被现有 E2E 间接证明）

E2E 用 `MOUNT_FRONTEND=true` 让后端托管 `apps/web/dist`，Playwright 能完整操作界面，
说明"后端托管 dist"这条路径在真实浏览器里是通的，不需要额外 spike。
选择：v1 用后端托管；`loadFile/app://` 不列入待办。

## ③ 打包链路（已跑通）

**做法**：`pyinstaller/backend.spec`（单文件，按 AGENTS §5）+ `pyinstaller/build.py`（检查前置、调用
PyInstaller、把产物装到 `apps/api/dist_backend/`，与 `electron-builder.yml` 的 `extraResources` 对齐）。
资源全部塞进 exe：`alembic/`、`alembic.ini`、`frontend-dist/`、`pyemb/`。

**实测（35–40MB 单文件）**：

```
backend.exe --port 8031 --data-dir <tmp> --log-level warning
  /health         → 200
  /               → 200，返回 exe 内的 index.html（SPA 可用）
  /api/workflows  → 200
  数据目录         → 注入目录里出现 agentflow.db；没有再落到 AppData
  迁移             → 建表 + alembic_version=0001（用的是 exe 内的 alembic）
  跑一条工作流      → 状态 success；脚本节点输出
                     exe = ...\_MEI000045502\pyemb\python.exe，ver = 3.12.10
                     （即用了随包解释器，而不是 backend.exe 自己）
```

**过程中修掉的两个真问题**：

1. `uvicorn.run("app.main:app")` 用字符串导入，冻结后解析不到 → `run.py` 在非 reload 时直接传 app 对象；
   spec 里再用 `collect_submodules("app")` 兜住动态导入。
2. `run.py` 顶部 `from app.core.config import ...` 会**在写环境变量之前**实例化 `Settings`，
   导致 `--data-dir` 等全部失效（实测库写到了 `AppData\data`）→ 默认值移到无副作用的
   `app/core/defaults.py`，并加了一条子进程回归测试守住这个约束。

**环境限制（仅影响本机沙箱，不影响正常构建）**：当前沙箱禁止删除/覆盖已存在的文件
（`WinError 5` / `DENY(DC)`），因此 `build.py` 的最后一步"装机到 dist_backend"在本机失败；
在普通环境上该步骤正常。构建产物本身已跑通验证。

**发布链路已同步**（`release.yml`）：原来 CI 里是一条裸 PyInstaller 命令
（`--onefile src/app/run.py --distpath electron/resources`），打不出带资源的包。
现在 CI 与本地同一条链路：准备 `pyinstaller/pyemb` → `pnpm build:web` →
`uv run --project apps/api --with pyinstaller python pyinstaller/build.py` →
`electron-builder --win nsis`，并在上传前断言
`apps/api/dist_backend/backend.exe` 与安装包都已产出。

## ④ Electron 装配 + 安装包冒烟（已跑通）

**装配做的事**（`electron/main.js`）：壳负责后端全生命周期——找空闲端口 → spawn
`resources/backend/backend.exe`（带 `--port/--data-dir/--log-level`）→ 轮询 `/health` →
`loadURL(127.0.0.1:port)` → 退出/崩溃收尸。

| 能力 | 实现要点 |
|---|---|
| 端口 | `net.listen(0)` 取空闲端口，避免 8000 冲突 |
| 数据目录 | `--data-dir %APPDATA%\AgentFlow`（`app.setName` 在建窗口前调用，否则会落到 scoped 包名目录） |
| 就绪等待 | 轮询 `/health`，30s 超时；进程提前退出立即失败（不白等） |
| 启动失败 | 对话框「重试 / 打开日志目录 / 退出」，不再白屏 |
| 日志 | `userData/logs/backend.log`（后端 stdout/stderr 落盘，托盘可打开） |
| 单实例 | `requestSingleInstanceLock()`，第二次启动聚焦已有窗口 |
| 孤儿清理 | 后端自写 `backend.pid`；启动时按它 kill 进程树（**不能用壳记的 pid**：单文件 exe 有引导/服务两代） |
| 退出清理 | `before-quit`/`will-quit` → `taskkill /T /F` |
| 导航 | 只允许 `127.0.0.1:<port>`，外链走系统浏览器 |

**unpacked 实测**（`electron-builder --dir`）：启动后 1 个主进程 + 后端 `--port 60307
--data-dir ...\Roaming\AgentFlow`，`/health` 200、`/` 返回 SPA；日志 6 行（DEBUG 已关）；
关窗后 `backend.exe` 归零；强杀壳造出孤儿后重启，日志出现 `清理遗留后端 pid=16596`、
旧端口释放、新实例正常。

**NSIS 安装包实测**（`AgentFlow Setup 0.1.0.exe`，117.8MB）：

```
1) 静默安装 /S  → 安装目录 ✓  开始菜单快捷方式 1  桌面快捷方式 1
2) 启动          → 主进程 1；后端 :56416；/health 200；/ 返回 SPA
3) 关闭窗口      → AgentFlow 0  backend 0
4) 静默卸载 /S  → 安装目录已删  快捷方式 0/0  注册表项 0  用户数据保留
```

**过程中修掉的 4 个真问题**：
1. `app.setName` 未调用 → 数据目录落到 `%APPDATA%\@agentflow\electron-shell`（含斜杠）
2. 打包态 `DEBUG` 默认 True → 每条 SQL 都进日志（几秒上百行）
3. 无托盘图标时"关窗只隐藏" → 应用变后台幽灵（改成:有托盘才隐藏）
4. 卸载后残留**空**安装目录 → NSIS 工作目录在 `$INSTDIR`；用 `build/installer.nsh`
   的 `customUnInstall` 里 `SetOutPath $TEMP` + `RMDir "$INSTDIR"` 解决

**构建环境注意**（仅本机）：`ELECTRON_RUN_AS_NODE` 会从父进程继承（VS Code 终端常见），
不清理会让 Electron 把自己当 Node 跑（报 `Cannot read properties of undefined (reading 'isPackaged')`）；
GitHub 下载被墙时用 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror；
无管理员权限时 `winCodeSign` 解压（含符号链接）会失败，用
`--config.win.signAndEditExecutable=false` 跳过（代价：exe 无自定义图标/版本信息）。

## 待用户拍板：打包形态与 AGENTS §5 冲突

`AGENTS.md` §5 写的是「PyInstaller **单文件** exe」，但本次实测：

| 形态 | 启动耗时 | 实测问题 |
|---|---|---|
| onedir | 0.6s | 无（不写系统 TEMP） |
| onefile | 未测到（受限环境里卡在解压 DLL 到 TEMP） | 每次启动都要解压到 TEMP，启动更慢、被杀软扫描概率更高 |

建议把 §5 改成 onedir；但 AGENTS.md 属"不得随意修改"，需要你确认后我再动。
