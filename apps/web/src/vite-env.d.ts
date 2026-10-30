/// <reference types="vite/client" />
/// <reference types="electron" />

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
