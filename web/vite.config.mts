import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// root = web/. 개발: http://127.0.0.1:5173 (API는 127.0.0.1:5174 로 프록시), 빌드: web/dist
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:5174', changeOrigin: false } },
  },
});
