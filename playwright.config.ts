import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * 浏览器走查（M3.5 验收标准 3）。
 *
 * 后端直接以 `MOUNT_FRONTEND=true` 托管 `apps/web/dist`，只需要一个进程；
 * 数据目录用 `e2e/.data`，不污染开发库。
 *
 * 前置：`pnpm build:web`（`pnpm e2e` 会自动先构建）。
 */

const PORT = 8123;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.resolve(process.cwd(), 'e2e', '.data');

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // 所有用例共享同一个后端与库，串行执行最稳
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'uv run --directory apps/api python -m app.run',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      MOUNT_FRONTEND: 'true',
      HOST: '127.0.0.1',
      PORT: String(PORT),
      DEBUG: 'false',
      DATA_DIR,
    },
  },
});
