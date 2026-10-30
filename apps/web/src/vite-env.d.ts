/// <reference types="vite/client" />

// Electron 由 preload 注入，不依赖 electron 包的 npm 类型（该包不在 web workspace 内）
interface Window {
  electronAPI?: {
    getBackendPort: () => Promise<number>;
    openDataDir: () => Promise<void>;
    openSaveDialog: (options?: any) => Promise<{ canceled: boolean; filePath?: string }>;
    openFileDialog: (options?: any) => Promise<{ canceled: boolean; filePaths: string[] }>;
    notify: (title: string, body?: string) => Promise<void>;
    restartBackend: () => Promise<void>;
  };
}
