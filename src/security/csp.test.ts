import { describe, expect, it } from 'vitest'

import { CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_META } from './csp'

function directive(name: string): string {
  const found = CONTENT_SECURITY_POLICY.split('; ').find((part) => part.startsWith(`${name} `))
  if (!found) throw new Error(`no ${name} directive in the policy`)
  return found
}

/**
 * These assertions are the point of the policy: if a future change widens one
 * of them, it has to be a deliberate edit to this test as well as the constant,
 * and the threat model in docs/SECURITY.md says what it is allowed to be.
 */
describe('content security policy', () => {
  it('defaults to the app’s own origin', () => {
    expect(directive('default-src')).toBe("default-src 'self'")
  })

  it('does not allow inline scripts', () => {
    const script = directive('script-src')
    expect(script).toContain("'self'")
    expect(script).not.toContain("'unsafe-inline'")
    expect(script).not.toContain("'unsafe-eval'")
  })

  it('allows WebAssembly, which libsodium needs for Argon2id', () => {
    expect(directive('script-src')).toContain("'wasm-unsafe-eval'")
  })

  it('allows inline styles, which React style attributes need', () => {
    expect(directive('style-src')).toContain("'unsafe-inline'")
  })

  it('lets the wallet and the Waku node reach their endpoints over https and wss', () => {
    const connect = directive('connect-src')
    expect(connect).toContain("'self'")
    expect(connect).toContain('https:')
    expect(connect).toContain('wss:')
    expect(connect).not.toContain('http://')
  })

  it('refuses plugins, a rewritten base and cross-origin form posts', () => {
    expect(directive('object-src')).toBe("object-src 'none'")
    expect(directive('base-uri')).toBe("base-uri 'none'")
    expect(directive('form-action')).toBe("form-action 'none'")
  })

  it('leaves out directives that a meta policy would only warn about', () => {
    // frame-ancestors needs a response header, which GitHub Pages cannot set.
    expect(CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors')
  })

  it('renders as a meta tag carrying the whole policy', () => {
    expect(CONTENT_SECURITY_POLICY_META).toBe(
      `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
    )
  })
})
