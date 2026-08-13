import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4100', changeOrigin: true, rewrite: path => path.replace(/^\/api/, '') },
      '/companion': { target: 'http://127.0.0.1:4101', changeOrigin: true, rewrite: path => path.replace(/^\/companion/, '') },
    },
  },
})
