import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'context-worker': resolve('src/main/context/context-worker.ts'),
          'presage-worker': resolve('src/main/sensor/presage-worker.ts'),
        },
      },
      externalizeDeps: { exclude: ['@trueiris/shared', '@trueiris/schemas'] },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  },
});
