import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 5173; /api is proxied to the FastAPI backend on 8000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
});
