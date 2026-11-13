import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Atlas does send CORS headers (it reflects the Origin), but the proxy keeps
// the app independent of that and makes requests same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/atlas': {
        target: 'https://atlas.ripe.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/atlas/, '/api/v2'),
      },
    },
  },
})
