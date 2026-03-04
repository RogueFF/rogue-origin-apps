import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['fern.tail2237bd.ts.net'],
    hmr: false,
    proxy: {
      '/gw-ws': {
        target: 'ws://localhost:18789',
        ws: true,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/gw-ws/, ''),
        headers: {
          'X-Forwarded-Proto': 'https',
        },
      },
      '/api/production': {
        target: 'https://rogue-origin-api.roguefamilyfarms.workers.dev',
        changeOrigin: true,
        secure: true,
      },
      '/api/system': {
        target: 'http://127.0.0.1:9501',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/system/, '/stats'),
      },
      '/api/mc': {
        target: 'https://mission-control-api.roguefamilyfarms.workers.dev',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/mc/, '/api'),
      },
    },
  },
})
