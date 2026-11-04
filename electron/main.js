/**
 * AgentFlow 桌面壳：负责后端进程的完整生命周期。
 *
 * 打包后没有"手动起的后端"了，壳必须自己：
 *   1) 找一个空闲端口  2) spawn backend.exe 并把端口/数据目录传进去
 *   3) 轮询 /health 直到就绪  4) 开窗口 loadURL(同源地址)  5) 退出/崩溃时收尸
 *
 * 关键约定（与后端契约一致，见 apps/api/src/app/run.py）：
 *   backend.exe --host 127.0.0.1 --port <port> --data-dir <userData> --log-level warning
 */
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

// 必须在使用 app.getPath('userData') 之前改名：否则会落到 package.json 的
// scoped 包名目录（%APPDATA%\@agentflow\electron-shell），既有可读性问题，
// 也会让"数据目录"与产品名对不上。displayed 名称仍是 AgentFlow。
app.setName('AgentFlow');

const DEV = !app.isPackaged;
const DEV_URL = process.env.AGENTFLOW_DEV_URL || 'http://localhost:5174';
const HEALTH_TIMEOUT_MS = Number(process.env.AGENTFLOW_HEALTH_TIMEOUT_MS || 30000);

const USER_DATA_DIR = app.getPath('userData');
const LOG_DIR = path.join(USER_DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'backend.log');
const RUNTIME_FILE = path.join(USER_DATA_DIR, 'backend-runtime.json');

let mainWin = null;
let tray = null;
let backendProc = null;
let backendPort = 0;
let quitting = false;
let logStream = null;

// ---------------------------------------------------------------- 工具

function logToFile(line) {
  try {
    if (!logStream) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    }
    logStream.write(line.endsWith('\n') ? line : line + '\n');
  } catch {
    /* 日志失败不能影响启动 */
  }
}

function writeRuntime(info) {
  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(RUNTIME_FILE, JSON.stringify(info, null, 2), 'utf8');
  } catch {
    /* 非致命 */
  }
}

function readRuntime() {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function findFreePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(0));
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function pingHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(port, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 进程提前退出就没必要再等了，直接失败（省 30s 白等）
    if (backendProc === null) throw new Error('后端进程启动后立即退出（详见日志）');
    if (await pingHealth(port)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`后端起不来：${timeoutMs}ms 内 /health 没有返回 200`);
}

// ---------------------------------------------------------------- 后端

/** 打包布局优先（electron-builder 的 extraResources: to: backend），开发态回退到构建产物。 */
function resolveBackendExe() {
  const candidates = [
    process.env.AGENTFLOW_BACKEND_EXE,
    path.join(process.resourcesPath || '', 'backend', 'backend.exe'),
    path.join(process.resourcesPath || '', 'backend.exe'),
    path.join(__dirname, '..', 'apps', 'api', 'dist_backend', 'backend.exe'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** 清理上次崩溃/强杀留下的后端（否则它会一直占着端口与数据库）。 */
function cleanupStaleBackend() {
  // 优先用后端自己写的 pid 文件：单文件 exe 有"引导进程 + 服务进程"两代，
  // 壳记的 pid 可能是先退出的那一代（实测会漏杀，孤儿一直占端口）
  const pidFile = path.join(USER_DATA_DIR, 'backend.pid');
  const recorded = readRuntime();

  const candidates = [];
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    if (raw) candidates.push(Number(raw));
  } catch {
    /* 没有 pid 文件 */
  }
  if (recorded?.pid) candidates.push(Number(recorded.pid));

  let killed = false;
  for (const pid of candidates) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0); // 只探活
    } catch {
      continue; // 已经不在
    }
    logToFile(`[shell] 清理遗留后端 pid=${pid}`);
    killTree(pid);
    killed = true;
  }

  fs.rmSync(pidFile, { force: true });
  fs.rmSync(RUNTIME_FILE, { force: true });
  return killed;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    // Windows 上 SIGTERM 对 python 子进程常常无效，必须杀进程树
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* 已退出 */
  }
}

async function startBackend() {
  const exe = resolveBackendExe();
  if (!exe) {
    throw new Error(
      '找不到后端程序 backend.exe。\n' +
      '打包产物应在 resources/backend/backend.exe；开发验证可设 AGENTFLOW_BACKEND_EXE 指定路径。',
    );
  }

  backendPort = (await findFreePort()) || 8000;
  const args = [
    '--host',
    '127.0.0.1',
    '--port',
    String(backendPort),
    '--data-dir',
    USER_DATA_DIR,
    '--log-level',
    'warning',
  ];

  logToFile(`\n[shell] ${new Date().toISOString()} spawn ${exe} ${args.join(' ')}`);

  backendProc = spawn(exe, args, {
    cwd: USER_DATA_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      // 后端日志里有中文：不指定编码时 Python 在 Windows 会按 cp936 写 stdout，
      // 壳按 UTF-8 解出来就是乱码，日志失去可读性（也影响排障）。
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });

  backendProc.stdout?.on('data', (buf) => logToFile(`[backend] ${buf.toString().trimEnd()}`));
  backendProc.stderr?.on('data', (buf) => logToFile(`[backend] ${buf.toString().trimEnd()}`));

  backendProc.on('error', (err) => {
    logToFile(`[shell] spawn 失败：${err.message}`);
    backendProc = null;
  });

  backendProc.on('exit', (code, signal) => {
    const exited = `[shell] backend 退出 code=${code} signal=${signal}`;
    logToFile(exited);
    backendProc = null;
    if (!quitting) handleBackendCrash(exited);
  });

  writeRuntime({ pid: backendProc.pid, port: backendPort, startedAt: new Date().toISOString() });

  await waitForBackend(backendPort);
  logToFile(`[shell] backend ready on http://127.0.0.1:${backendPort}`);
  return backendPort;
}

function stopBackend() {
  const proc = backendProc;
  backendProc = null;
  fs.rmSync(RUNTIME_FILE, { force: true });
  if (!proc || proc.exitCode !== null) return;
  logToFile(`[shell] 停止 backend pid=${proc.pid}`);
  killTree(proc.pid);
}

/** 后端在运行途中挂掉：给用户可操作的提示，而不是一个报错的空窗口。 */
async function handleBackendCrash(detail) {
  if (!mainWin || mainWin.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(mainWin, {
    type: 'error',
    title: '后端已停止',
    message: 'AgentFlow 的后端服务意外退出。',
    detail: `${detail}\n\n日志：${LOG_FILE}`,
    buttons: ['重启后端', '打开日志目录', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 1) {
    shell.openPath(LOG_DIR);
    return;
  }
  if (response === 2) {
    quitting = true;
    app.quit();
    return;
  }
  try {
    await startBackend();
    mainWin.loadURL(backendUrl());
  } catch (err) {
    await showStartupError(err);
  }
}

function backendUrl() {
  return `http://127.0.0.1:${backendPort}/`;
}

/** 启动期失败：重试 / 打开日志 / 退出。返回 false 表示用户选择退出。 */
async function showStartupError(err) {
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'AgentFlow 启动失败',
    message: '后端服务未能启动。',
    detail: `${err.message}\n\n日志：${LOG_FILE}`,
    buttons: ['重试', '打开日志目录', '退出'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (response === 1) {
    shell.openPath(LOG_DIR);
    return true;
  }
  if (response === 2) return false;
  return true;
}

// ---------------------------------------------------------------- 窗口

function isLocalUrl(url) {
  return typeof url === 'string' && url.startsWith(`http://127.0.0.1:${backendPort}`);
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = DEV ? DEV_URL : backendUrl();
  mainWin.loadURL(url).catch(async (err) => {
    // 白屏不能静默：打包态首页由后端托管，加载失败通常意味着后端异常或端口被占
    logToFile(`[shell] loadURL 失败 ${url}：${err.message}`);
    if (DEV) return;
    const { response } = await dialog.showMessageBox(mainWin, {
      type: 'error',
      title: 'AgentFlow 页面加载失败',
      message: '无法加载界面。',
      detail: `${err.message}\n\n日志：${LOG_FILE}`,
      buttons: ['重试', '打开日志目录', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) {
      quitting = true;
      app.quit();
      return;
    }
    if (response === 1) {
      shell.openPath(LOG_DIR);
      return;
    }
    mainWin?.loadURL(url).catch((retryError) => logToFile(`[shell] 重试仍失败：${retryError.message}`));
  });
  mainWin.once('ready-to-show', () => mainWin.show());

  mainWin.on('close', (event) => {
    // 有托盘时关窗只隐藏（还能从托盘叫回来）；没有托盘时必须真关，
    // 否则用户点了叉就再也找不回窗口，只剩后台幽灵进程。
    if (!quitting && tray) {
      event.preventDefault();
      mainWin.hide();
    }
  });

  mainWin.on('closed', () => {
    mainWin = null;
  });

  mainWin.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    logToFile(`[shell] did-fail-load ${code} ${description} ${validatedUrl}`);
  });

  // 只允许停留在本地后端；外链交给系统浏览器（AGENTS §6）
  mainWin.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocalUrl(target)) return { action: 'allow' };
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (event, target) => {
    if (isLocalUrl(target) || (DEV && target.startsWith(DEV_URL))) return;
    event.preventDefault();
    if (/^https?:/i.test(target)) shell.openExternal(target);
  });
}

function showWindow() {
  if (!mainWin || mainWin.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

// ---------------------------------------------------------------- 安全策略

/**
 * 给打包后的页面加 CSP（评审 G34 剩余项）。
 *
 * 只在生产态注入：dev 走 Vite，需要内联脚本与 HMR 的 ws 连接，加 CSP 会直接白屏。
 */
function installContentSecurityPolicy() {
  if (DEV) return;

  const { session } = require('electron');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    // Ant Design 会在运行时注入内联样式，style 的内联必须放开
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // 页面与 API 同源（后端托管 dist），SSE 也是同源
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
  logToFile('[shell] 已启用 CSP');
}

// ---------------------------------------------------------------- 托盘 / IPC

function setupTray() {
  // 图标只有一个来源：electron/build/icon.ico（electron-builder 的 buildResources 目录）。
  // 它会被打进 asar 的 build/ 下，所以托盘与安装包用的是同一张图（A1）。
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'icon.ico'),
    path.join(process.resourcesPath || '', 'build', 'icon.ico'),
  ];
  const iconPath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!iconPath) {
    // 没有图标就别硬建托盘（建一个空图标托盘比没有更糟）
    logToFile('[shell] 未找到 icon.ico（期望 electron/build/icon.ico），跳过托盘');
    return;
  }
  tray = new Tray(iconPath);
  tray.setToolTip('AgentFlow');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开窗口', click: showWindow },
      { label: '打开数据目录', click: () => shell.openPath(USER_DATA_DIR) },
      { label: '打开日志', click: () => shell.openPath(LOG_FILE) },
      { type: 'separator' },
      {
        label: '退出 AgentFlow',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => {
    if (mainWin && mainWin.isVisible()) mainWin.hide();
    else showWindow();
  });
}

function setupIPC() {
  ipcMain.handle('open-data-dir', () => shell.openPath(USER_DATA_DIR));
  ipcMain.handle('open-log-dir', () => shell.openPath(LOG_DIR));
  ipcMain.handle('notify', (_event, title, body) => {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  });
  ipcMain.handle('open-save-dialog', (_event, options) =>
    dialog.showSaveDialog(mainWin, options || {}),
  );
  ipcMain.handle('open-file-dialog', (_event, options) =>
    dialog.showOpenDialog(mainWin, options || {}),
  );
}

// ---------------------------------------------------------------- 生命周期

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());

  app.whenReady().then(async () => {
    setupIPC();
    installContentSecurityPolicy();

    if (DEV) {
      // 开发态：后端由 `pnpm dev` 起（Vite 代理到 127.0.0.1:8000）
      createWindow();
      setupTray();
      return;
    }

    cleanupStaleBackend();
    for (; ;) {
      try {
        await startBackend();
        break;
      } catch (err) {
        logToFile(`[shell] 启动失败：${err.message}`);
        if (!(await showStartupError(err))) {
          quitting = true;
          app.quit();
          return;
        }
      }
    }

    createWindow();
    setupTray();
  });

  app.on('activate', () => showWindow());

  app.on('before-quit', () => {
    quitting = true;
    stopBackend();
  });

  app.on('window-all-closed', () => {
    // 窗口关闭被拦截成隐藏，这里只在"真的没有窗口"时兜底
    if (process.platform !== 'darwin' && (!tray || quitting)) app.quit();
  });

  app.on('will-quit', () => {
    stopBackend();
    logStream?.end();
  });
}
