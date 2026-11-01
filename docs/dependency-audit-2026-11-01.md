# 依赖漏洞与许可证审计 · 2026-11-01

> 对应 backlog **B2**（评审 §9 明确"未审计"）。此前 `pnpm audit` / `pip-audit` 从未执行过。
> 本文记录**这次实际跑出来的结果**、处置决定，以及以后怎么重复跑。

## 1. 怎么跑

```bash
pnpm audit:js    # pnpm audit --prod --audit-level high（只审计生产依赖，high/critical 才失败）
pnpm audit:py    # uv export --no-dev → uvx pip-audit -r（产物临时生成，不落库）
```

CI：`.github/workflows/ci.yml` 的 `security` job，**每周一 02:00 定时 + 手动触发**。
不在 PR 上跑是因为新披露的 CVE 与本次改动无关，卡红 PR 会让人习惯性绕过安全门禁。

## 2. JavaScript（pnpm，生产依赖 98 个）

```text
2 vulnerabilities found
Severity: 2 moderate
```

| 包 | 严重度 | 公告 | 影响范围 | 修复版本 |
|---|---|---|---|---|
| react-router | moderate | [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6)：`<Link>` / `useNavigate` 反斜杠开放重定向（CVE-2025-68470 绕过） | `>=6.0.0 <7.18.0` | `>=7.18.0` |
| react-router | moderate | [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg)：SSR hydration 中 `deserializeErrors()` 的任意构造函数注入 | `>=6.4.0 <7.18.0` | `>=7.18.0` |

**处置：v0.1 记录为已接受风险（accepted risk），不升级。**

理由（不是"懒得升"）：

1. 修复只存在于 **react-router v7**，而 `AGENTS.md §5` 锁定 React Router v6；升 v7 是跨大版本迁移（`createBrowserRouter` 之外的数据 API、future flags 全面变化），不属于 v0.1 收尾范围。
2. 漏洞一需要**把不可信输入拼进导航目标**。本应用是本地单用户桌面工具，路由目标全部来自代码内常量（`/workflows`、`/runs`…）与后端返回的 id，没有"外链跳转"入口。
3. 漏洞二要求 **SSR hydration + 攻击者可控的 loader 错误负载**。本项目是纯 SPA（Vite `index.html` + `createBrowserRouter`），不使用 SSR。

**触发升级的条件**（写下来，避免遗忘）：一旦出现"从工作流/运行数据里读取 URL 并 `navigate()`/`<Link to>`"的功能，或引入 SSR/数据路由，必须同步升级到 v7.18+。

## 3. Python（uv.lock，运行时 33 个包）

```text
No known vulnerabilities found
```

许可证分布（运行时依赖）：

| 许可证 | 数量 |
|---|---|
| MIT / MIT License | 17 |
| BSD-3-Clause / BSD License | 11 |
| Apache-2.0 / Apache-2.0 OR BSD-3-Clause | 2 |
| PSF-2.0 | 1 |
| MIT-0 | 1 |
| MPL-2.0（`certifi`） | 1 |

- 无 GPL / AGPL / SSPL，**无强 copyleft**，桌面单机分发无传染风险。
- `certifi` 是 MPL-2.0（文件级 copyleft）：只作为未修改的依赖分发，满足要求；**如果将来修改 certifi 源码**必须公开该文件的修改。
- `cryptography` 是 `Apache-2.0 OR BSD-3-Clause` 双许可，默认按 Apache-2.0 使用。

## 4. JavaScript 许可证

`pnpm licenses list --prod --json` 汇总：**98 个包，全部为宽松许可**。

| 许可证 | 数量 |
|---|---|
| MIT | 89 |
| ISC | 8 |
| BSD-3-Clause | 1 |

无 GPL / AGPL / SSPL / CC-BY-NC 等限制性许可。

## 5. 结论

| 项 | 状态 |
|---|---|
| 生产依赖已知漏洞 | 2 个 moderate（react-router），**已评估并接受**，附升级触发条件 |
| Python 已知漏洞 | 0 |
| 许可证 | 无强 copyleft、无禁止商用条款；MPL-2.0 仅 certifi，合规 |
| 可重复性 | `pnpm audit:js` / `pnpm audit:py` + CI 周检 |

> 提醒：审计是**快照**。任何"没跑过"的结论都会过期，所以 CI 定时跑比这次的结果更重要。
