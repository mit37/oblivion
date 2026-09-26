import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages serves project sites under /<repo>/, so CI builds with VITE_BASE=/oblivion/.
// Local dev, preview and tests use '/'.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
