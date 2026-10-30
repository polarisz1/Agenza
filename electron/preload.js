/**
 * preload.js - whitelisted bridge for renderer → main.
 * All raw Node API stays OUT; only these methods are exposed via
 * contextBridge. DO NOT add new handlers without a clear security need.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Backend & window ---
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  openDataDir: () => ipcRenderer.invoke('open-data-dir'),

  // --- Dialogs ---
  openSaveDialog: (options) => ipcRenderer.invoke('open-save-dialog', options),
  openFileDialog: (options) => ipcRenderer.invoke('open-file-dialog', options),

  // --- Native UX ---
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
});
