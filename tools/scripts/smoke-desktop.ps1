<#
.SYNOPSIS
  桌面安装包冒烟：装 → 启动 → /health + 首页 → 关窗 → 卸载 → 检查残留。

.DESCRIPTION
  M4-T8：把手工验证过一次的流程固化成脚本，CI 与本地共用。
  任何一步失败都会 throw，退出码非 0。

.PARAMETER Installer
  安装包路径（AgentFlow Setup x.y.z.exe）。

.PARAMETER KeepUserData
  保留 %APPDATA%\AgentFlow（默认不保留，保证每次从干净状态开始）。

.EXAMPLE
  pwsh -File tools/scripts/smoke-desktop.ps1 -Installer "electron/dist_electron/AgentFlow Setup 0.1.0.exe"
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [switch]$KeepUserData
)

$ErrorActionPreference = 'Stop'

# 从 VS Code / Electron 系终端继承来的 ELECTRON_RUN_AS_NODE 会让 Electron
# 把自己当 Node 跑，表现为"启动即退出、连日志都不写"（本机实测踩到）
if (Test-Path Env:\ELECTRON_RUN_AS_NODE) {
  Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
}

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\AgentFlow'
$userData = Join-Path $env:APPDATA 'AgentFlow'
$logFile = Join-Path $userData 'logs\backend.log'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$uninstallReg = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'

function Step([string]$message) { Write-Host "==> $message" -ForegroundColor Cyan }

function Fail([string]$message) {
  Write-Host "✗ $message" -ForegroundColor Red
  exit 1
}

function Stop-Leftovers {
  Get-Process AgentFlow, backend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

function Wait-Until([scriptblock]$condition, [int]$timeoutSeconds, [string]$what) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (& $condition) { return }
    Start-Sleep -Milliseconds 500
  }
  Fail "等待超时（${timeoutSeconds}s）：$what"
}

try {
  if (-not (Test-Path $Installer)) { Fail "找不到安装包：$Installer" }
  $installer = (Resolve-Path $Installer).Path

  Step '清理上次残留'
  Stop-Leftovers
  if (-not $KeepUserData -and (Test-Path $userData)) {
    Remove-Item $userData -Recurse -Force -ErrorAction SilentlyContinue
  }

  Step "静默安装 $([System.IO.Path]::GetFileName($installer))"
  $p = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -Wait
  if ($p.ExitCode -ne 0) { Fail "安装器退出码 $($p.ExitCode)" }

  $exe = Join-Path $installDir 'AgentFlow.exe'
  if (-not (Test-Path $exe)) { Fail "安装后找不到 $exe" }
  $cleanup = @()

  $shortcuts = (Get-ChildItem $startMenu -Filter '*AgentFlow*' -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
  if ($shortcuts -lt 1) { Fail '没有创建开始菜单快捷方式' }
  Write-Host "    开始菜单快捷方式：$shortcuts"

  Step '启动应用'
  $app = Start-Process -FilePath $exe -PassThru
  $cleanup += $app
  Start-Sleep -Seconds 3
  if ($app.HasExited) {
    Fail "应用启动后立即退出（exit=$($app.ExitCode)）。常见原因：安装包损坏、缺少 VC 运行库、或继承了 ELECTRON_RUN_AS_NODE。"
  }

  Wait-Until { (Test-Path $logFile) -and ((Get-Content $logFile -Raw -ErrorAction SilentlyContinue) -match 'backend ready on http://127\.0\.0\.1:(\d+)') } 90 '后端就绪日志'

  $log = Get-Content $logFile -Raw
  if ($log -notmatch 'backend ready on http://127\.0\.0\.1:(\d+)') { Fail '日志里没有后端就绪记录' }
  $port = [int]$Matches[1]
  Write-Host "    后端端口：$port"

  Step '检查 /health 与首页'
  $health = Invoke-WebRequest "http://127.0.0.1:$port/health" -TimeoutSec 10 -UseBasicParsing
  if ($health.StatusCode -ne 200 -or $health.Content -notmatch '"status"\s*:\s*"ok"') {
    Fail "/health 不健康：$($health.StatusCode) $($health.Content)"
  }
  $page = Invoke-WebRequest "http://127.0.0.1:$port/" -TimeoutSec 15 -UseBasicParsing
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'id="root"') {
    Fail "首页不是前端页面：status=$($page.StatusCode) len=$($page.Content.Length)"
  }
  Write-Host "    首页：$($page.StatusCode)，含 <div id=`"root`">"

  Step '关闭窗口（应连带结束后端）'
  $win = Get-Process AgentFlow -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $win) { Fail '没有找到带窗口的进程' }
  $win.CloseMainWindow() | Out-Null
  Wait-Until { -not (Get-Process AgentFlow -ErrorAction SilentlyContinue) } 30 '应用退出'
  Wait-Until { -not (Get-Process backend -ErrorAction SilentlyContinue) } 30 '后端退出'
  Write-Host '    应用与后端均已退出'

  Step '静默卸载'
  $uninstaller = Join-Path $installDir 'Uninstall AgentFlow.exe'
  if (-not (Test-Path $uninstaller)) { Fail "找不到卸载器：$uninstaller" }
  $u = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
  if ($u.ExitCode -ne 0) { Fail "卸载器退出码 $($u.ExitCode)" }

  Wait-Until { -not (Test-Path $installDir) } 60 '安装目录被删除'
  Write-Host '    安装目录已删除'

  $left = (Get-ItemProperty $uninstallReg -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*AgentFlow*' } | Measure-Object).Count
  if ($left -ne 0) { Fail "卸载后仍有 $left 条注册表项" }

  $shortcutsAfter = (Get-ChildItem $startMenu -Filter '*AgentFlow*' -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
  if ($shortcutsAfter -ne 0) { Fail "卸载后仍有 $shortcutsAfter 个快捷方式" }

  if ((Get-Process AgentFlow, backend -ErrorAction SilentlyContinue | Measure-Object).Count -ne 0) {
    Fail '卸载后仍有残留进程'
  }

  Write-Host ''
  Write-Host '✓ 桌面冒烟通过：安装 → 启动 → /health + 首页 → 关窗清理 → 卸载无残留' -ForegroundColor Green
  exit 0
}
catch {
  Write-Host "✗ 冒烟失败：$($_.Exception.Message)" -ForegroundColor Red
  Stop-Leftovers
  exit 1
}
