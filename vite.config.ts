import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const apiPort = Number(process.env.OMEGA_PORT ?? 4317);

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
