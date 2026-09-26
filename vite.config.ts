import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

import { CONTENT_SECURITY_POLICY_META } from './src/security/csp'

/**
 * Adds the Content-Security-Policy to the built HTML only. The dev server needs
 * inline scripts for its client and React Fast Refresh, so injecting the policy
 * there would mean shipping a weaker one. GitHub Pages cannot set response
 * headers, which is why this travels in the document.
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'oblivion-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('</head>', `    ${CONTENT_SECURITY_POLICY_META}\n  </head>`)
    },
  }
}

// GitHub Pages serves project sites under /<repo>/, so CI builds with VITE_BASE=/oblivion/.
// Local dev, preview and tests use '/'.
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
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
