// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'public',
  publicDir: 'public',
  server: {
    port: 3000,
    host: true,
    open: false,
    // proxy: { '/api': 'http://localhost:3001' } // enable if you run server.js on 3001
  },
  build: {
    outDir: '../dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@js':  '/js',
      '@css': '/css'
    }
  }
});