import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite config for standalone web build (not Electron)
export default defineConfig({
  plugins: [react()],

  root: './src/renderer',

  build: {
    outDir: '../../backend/web',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: './src/renderer/index.html',
    },
  },

  server: {
    port: 3001,
    host: '0.0.0.0',
    proxy: {
      // Proxy API requests to Go backend during development
      '/api': {
        target: 'http://localhost:8090',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8090',
        ws: true,
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
    },
  },

  define: {
    // Environment variables for web mode
    'process.env.IS_WEB': JSON.stringify(true),
  },
});
