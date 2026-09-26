/**
 * The Content-Security-Policy the production build ships.
 *
 * GitHub Pages cannot set response headers, so the policy travels as a
 * `<meta http-equiv>` tag injected by `vite.config.ts` into the built
 * `index.html` only — the dev server injects inline scripts for its client and
 * React Fast Refresh, and a policy that allowed those would be weaker than this
 * one for no gain. `docs/SECURITY.md` explains what it does and does not buy.
 *
 * Every directive here is load-bearing:
 *
 * - `default-src 'self'` — nothing loads from anywhere else by accident.
 * - `connect-src 'self' https: wss:` — the wallet's RPC endpoint and the Waku
 *   light node's peers are chosen at runtime (the public Sepolia endpoint by
 *   default; the SDK's own bootstrap list, or `VITE_WAKU_BOOTSTRAP_PEERS`), and
 *   Waku speaks HTTPS/WebSocket. Broad by necessity, and named in the threat
 *   model rather than pretended away.
 * - `script-src 'self' 'wasm-unsafe-eval'` — the app's own modules, and
 *   WebAssembly for libsodium's Argon2id. No `'unsafe-inline'`, so an injected
 *   inline `<script>` does not run.
 * - `style-src 'self' 'unsafe-inline'` — React sets `style` attributes (the QR
 *   SVG among others), which needs inline styles. Inline styles are not code
 *   execution, so this is the one allowance that does not widen the attack.
 * - `img-src 'self' data:` — the favicon, and nothing else.
 * - `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` — an embedded
 *   plugin, a rewritten `<base>` or a form POSTed elsewhere is never something
 *   this app wants.
 *
 * `frame-ancestors` is deliberately absent: it is ignored in a `<meta>` policy
 * (it only works as a response header, which GitHub Pages cannot set), so
 * clickjacking is a named gap in the threat model rather than a directive that
 * would only produce a console warning.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self' https: wss:",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** The tag `vite.config.ts` injects, and `e2e/smoke.spec.ts` asserts. */
export const CONTENT_SECURITY_POLICY_META = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
