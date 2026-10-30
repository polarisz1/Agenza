const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { URL } = require('url');

let mainWin = null;
let tray = null;
let backendProc = null;
let backendPort = 8000;
let appIsQuitting = false;

const DEV = !app.isPackaged;
const USER_DATA_DIR = app.getPath('userData');
const DEV_URL = process.env.AGENTFLOW_DEV_URL || 'http://localhost:5173';

/** Find a free TCP port (fallback to port 8001 if the probe fails). */
function findFreePort() {
  try {
    const net = require('net');
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
  } catch {
    return Promise.resolve(8001);
  }
}

/** Poll the backend /health endpoint until it responds. */
async function waitForBackend(port, timeoutMs = 30000) {
  const http = require('http');
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Backend did not start within ${timeoutMs}ms`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 2000 }, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(tryOnce, 500);
        }
      });
      req.on('error', () => setTimeout(tryOnce, 500));
      req.on('timeout', () => { req.destroy(); setTimeout(tryOnce, 500); });
    };
    tryOnce();
  });
}

async function startBackend() {
  if (DEV) {
    // Dev: assume FastAPI started manually via `pnpm dev:api`
    return;
  }

  backendPort = await findFreePort();
  const backendExe = path.join(process.resourcesPath, 'backend.exe');

  if (!fs.existsSync(backendExe)) {
    console.error(`[AgentFlow] backend.exe not found at ${backendExe}`);
    return;
  }

  backendProc = spawn(backendExe, ['--host', '127.0.0.1', '--port', String(backendPort)], {
    cwd: USER_DATA_DIR,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  backendProc.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`));
  backendProc.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`));
  backendProc.on('exit', (code) => {
    console.warn(`[AgentFlow] backend exited with code ${code}`);
    backendProc = null;
  });
  backendProc.on('error', (err) => console.error('[AgentFlow] backend spawn error', err));

  console.log(`[AgentFlow] Waiting for backend on port ${backendPort}...`);
  await waitForBackend(backendPort);
  console.log(`[AgentFlow] Backend ready on port ${backendPort}`);
}

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = DEV
    ? DEV_URL
    : `http://127.0.0.1:${backendPort}/`;

  mainWin.loadURL(url);
  mainWin.once('ready-to-show', () => mainWin.show());

  mainWin.on('close', (e) => {
    if (!appIsQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  mainWin.webContents.on('did-fail-load', (e, code, desc) => {
    console.error('[AgentFlow] Failed to load:', code, desc);
  });
}

function setupTray() {
  // Try to load icon; gracefully fall back on missing asset
  let icon;
  try {
    icon = path.join(__dirname, 'icon.ico');
  } catch { icon = null; }

  tray = new Tray(icon || __dirname);
  tray.setToolTip('AgentFlow');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开窗口', click: () => { createWindow(); mainWin?.show(); mainWin?.focus(); } },
      { label: '打开数据目录', click: () => shell.openPath(USER_DATA_DIR) },
      { type: 'separator' },
      { label: '退出 AgentFlow', click: () => { appIsQuitting = true; app.quit(); } },
    ])
  );
  tray.on('click', () => {
    if (!mainWin) createWindow();
    mainWin.isVisible() ? mainWin.hide() : (mainWin.show(), mainWin.focus());
  });
}

function setupIPC() {
  ipcMain.handle('get-backend-port', () => backendPort);

  ipcMain.handle('open-data-dir', () => shell.openPath(USER_DATA_DIR));

  ipcMain.handle('notify', (_e, title, body) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.handle('open-save-dialog', async (_e, options) => {
    return await dialog.showSaveDialog(mainWin, options || {});
  });

  ipcMain.handle('open-file-dialog', async (_e, options) => {
    return await dialog.showOpenDialog(mainWin, options || {});
  });
}

// ---- App Lifecycle ----
app.whenReady().then(async () => {
  try {
    await startBackend();
  } catch (err) {
    console.error('[AgentFlow] Backend startup failed:', err);
  }
  createWindow();
  setupTray();
  setupIPC();

  if (!DEV) {
    // electron-updater setup goes here (Phase 1+)
    // require('electron-updater').autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  appIsQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  if (backendProc) {
    console.log('[AgentFlow] Terminating backend...');
    try { backendProc.kill('SIGTERM'); } catch {}
  }
});
