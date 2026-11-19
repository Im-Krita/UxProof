import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@uxproof/audit-config-limits.json': path.resolve('runner/schemas/audit-config-limits.json'),
      '@uxproof/rule-registry.json': path.resolve('runner/rules/registry-v0.1.json')
    }
  },
  server: {
    host: '127.0.0.1', port: 1420, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4179', changeOrigin: true } }
  },
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_*']
});
