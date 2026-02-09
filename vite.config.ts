import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/LLM/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:26999'
    }
  }
})
