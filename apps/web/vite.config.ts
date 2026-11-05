import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // proxy target 必须是完整 URL（http:// 开头），不能是前端代码用的相对路径
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5174,
      // 不设 strictPort：5174 被占用时 Vite 自动递增到 5175/5176 继续启动。
      // 前端所有请求都走同源 /api（由下面的 proxy 转发），所以端口变化不影响可用性。
      host: true,
      open: false,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/docs': { target: apiProxyTarget, changeOrigin: true, secure: false },
        '/openapi.json': { target: apiProxyTarget, changeOrigin: true, secure: false },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'antd-vendor': ['antd', '@ant-design/icons'],
            'xyflow-vendor': ['@xyflow/react'],
          },
        },
      },
    },
  };
});
