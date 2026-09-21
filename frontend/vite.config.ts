import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The app calls same-origin `/api/...`; in dev the proxy forwards it to the backend so the session cookie
    // stays first-party (no CORS). The backend's FRONTEND_URL must be this dev server's URL (http://localhost:5173).
    proxy: { '/api': { target: 'http://localhost:3000' } },
  },
})
