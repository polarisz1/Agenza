# AgentFlow 开发环境（E 盘）

> 本机原有 Python 3.10 与 uv，但没有 Node/pnpm；为避免占用 C 盘，全部工具链与缓存都装在 **E 盘**。
> 本文记录布局与用法，换机器/新会话照此重建即可。

## 1. 目录布局

| 路径 | 内容 | 说明 |
|---|---|---|
| `E:\dev\node` | Node.js 22.23.4（portable zip 解压） | 不进 PATH 系统变量，靠 `env.ps1` 注入 |
| `E:\dev\npm-global` | `npm i -g` 的全局包（含 pnpm 9.12.0） | `NPM_CONFIG_PREFIX` |
| `E:\dev\pnpm-global` | pnpm 全局 bin | `PNPM_HOME` |
| `E:\dev\cache\npm` | npm 缓存 | `NPM_CONFIG_CACHE` |
| `E:\dev\cache\pnpm-store` | pnpm store | `.npmrc` 的 `store-dir` |
| `E:\dev\uv\cache` | uv 缓存 | `UV_CACHE_DIR` |
| `E:\dev\uv\python` | uv 下载的 CPython 3.12.13 | `UV_PYTHON_INSTALL_DIR` |
| `E:\dev\.npmrc` | npm/pnpm 全局配置 | 指向上面几个目录 |
| `E:\dev\env.ps1` | 环境加载脚本 | 每次新 shell 先 dot-source |
| `E:\dev\tmp` | 一次性调试脚本 | 可随时清理 |

仓库自身的 `node_modules`、`apps/api/.venv`、`apps/api/data` 都在 E 盘仓库目录内，符合"不落 C 盘"。

## 2. 每次开新 shell 的第一条命令

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force   # 本机默认禁止执行 .ps1
. 'E:\dev\env.ps1'
```

> 为什么不直接写进用户 PATH：`SetEnvironmentVariable(...,'User')` 只影响**新登录**的进程，
> 而当前 DSH 进程不会继承，所以显式 dot-source 最可靠。

验证：

```powershell
node -v      # v22.23.4
pnpm -v      # 9.12.0
uv run python -V   # 在 apps/api 下：Python 3.12.13
```

## 3. 常用命令

```powershell
# 依赖（首次或依赖变更后）
pnpm install
cd apps/api; uv sync --all-extras

# 一条命令起前后端（Ctrl+C 一起停；脚本在 tools/scripts/dev.mjs）
pnpm dev

# 后端
cd apps/api
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest -q
uv run python -m app.run          # 只起后端（127.0.0.1:8000）

# 前端
pnpm --filter @agentflow/web dev          # 只起前端（5173）
pnpm --filter @agentflow/web lint
pnpm --filter @agentflow/web format:check
pnpm --filter @agentflow/web build

# 契约
pnpm contracts:generate    # 后端 → openapi.yaml
pnpm contracts:build       # yaml → src/generated/index.ts
pnpm contracts:check       # CI 用的漂移检测
```

## 4. 已知环境坑

1. **执行策略**：直接 `. E:\dev\env.ps1` 会报"禁止运行脚本"，必须先 `Set-ExecutionPolicy -Scope Process Bypass`。
2. **换行**：本机 `core.autocrlf=true`，工作区是 CRLF；`.gitattributes` 已声明 `eol=lf`。
   `contracts:check` 现在会归一化换行后比较，不再因 CRLF 假报漂移。
3. **PowerShell 读文件**：`Get-Content` 默认按 ANSI 解码，读 UTF-8 中文会显示乱码——**不是文件损坏**，
   用 `-Encoding UTF8` 或 `read` 工具读。
4. **改路由 docstring 也要重新生成契约**：FastAPI 把 handler 的 docstring 写进 OpenAPI 的
   operation `description`，`contracts:check` 会逐字节比对，所以**注释改动也会让 CI 失败**。
   改完跑 `pnpm contracts:generate && pnpm contracts:build`。
5. **uv 缓存权限**（历史问题）：早期 `uv run` 失败于 `Failed to initialize cache`，
   现在缓存指向 `E:\dev\uv\cache`，且仓库内已有 `.venv`（`uv sync` 生成），可直接用。
6. **`apps/data`**：`core/config.py` 的 `ROOT_DIR = parents[4]` 实际指向 `apps/`（注释写的是仓库根），
   所以数据库落在 `apps/data/agentflow.db`、主密钥在 `apps/data/.secret.key`
   （已知缺陷 S13 / D-3，T8 会改成 env 显式注入）。该目录已被 `.gitignore` 的 `data/` 覆盖。
