import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },  // 5173 used by conk.app
  build: { outDir: 'dist', sourcemap: true },
  define: {
    // Required for @mysten/sui in browser
    global: 'globalThis',
  },
})
