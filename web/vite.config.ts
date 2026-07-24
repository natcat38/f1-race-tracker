import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project sites serve under /<repo>/, not /. docker-compose and
  // local dev never set VITE_STATIC_DEMO, so they keep the default '/'.
  base: process.env.VITE_STATIC_DEMO === 'true' ? '/f1-race-tracker/' : '/',
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/control': 'http://localhost:8080',
    },
  },
})
