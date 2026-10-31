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

## 待用户拍板：打包形态与 AGENTS §5 冲突

`AGENTS.md` §5 写的是「PyInstaller **单文件** exe」，但本次实测：

| 形态 | 启动耗时 | 实测问题 |
|---|---|---|
| onedir | 0.6s | 无（不写系统 TEMP） |
| onefile | 未测到（受限环境里卡在解压 DLL 到 TEMP） | 每次启动都要解压到 TEMP，启动更慢、被杀软扫描概率更高 |

建议把 §5 改成 onedir；但 AGENTS.md 属"不得随意修改"，需要你确认后我再动。
