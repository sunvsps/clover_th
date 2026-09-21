import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The API is same-origin in production (reverse proxy); in dev the proxy makes localhost:5173 the single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:3000', changeOrigin: false },
      '/healthz': { target: process.env.VITE_API_TARGET ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
})
