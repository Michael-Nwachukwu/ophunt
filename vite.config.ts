import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'path';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

const previewHost = process.env.LOCUS_PREVIEW_HOST;
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4100';

let backendProcess: ChildProcess | null = null;

function backendPlugin() {
  return {
    name: 'start-backend',
    configureServer() {
      if (backendProcess) return;

      console.log('[backend] installing deps and starting server...');

      // Install backend deps first, then start
      const install = spawn('npm', ['install', '--prefer-offline'], {
        cwd: path.resolve(__dirname, 'backend'),
        stdio: 'inherit',
        shell: true,
      });

      install.on('close', (code) => {
        if (code !== 0) {
          console.error('[backend] npm install failed with code', code);
          return;
        }
        console.log('[backend] deps ready, starting tsx...');
        backendProcess = spawn('npx', ['tsx', 'src/server.ts'], {
          cwd: path.resolve(__dirname, 'backend'),
          stdio: 'inherit',
          shell: true,
          env: { ...process.env, PORT: '4100' },
        });

        backendProcess.on('close', (c) => {
          console.log('[backend] process exited with code', c);
          backendProcess = null;
        });
      });
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react(), backendPlugin()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    allowedHosts: 'all',
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
    hmr: previewHost
      ? {
          host: previewHost,
          clientPort: 443,
          protocol: 'wss',
        }
      : undefined,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});