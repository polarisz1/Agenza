/**
 * preload.js - renderer → main 的白名单桥。
 * 只暴露下面这些方法；任何 Node 原生能力都不进渲染进程（AGENTS §6）。
 *
 * 注意：这里**没有** getBackendPort。打包后页面由后端自己托管，
 * 渲染进程与 API 同源，前端不需要知道端口；暴露它只会增加攻击面。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- 本地目录 ---
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),
  openLogDir: () => ipcRenderer.invoke('open-log-dir'),

  // --- 系统对话框 ---
  openSaveDialog: (options) => ipcRenderer.invoke('open-save-dialog', options),
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),

  // --- 原生提示 ---
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
});
