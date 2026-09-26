/**
 * Lazily loads libsodium ("sumo" build) exactly once, for the two reviewed
 * primitives this project uses: Argon2id (`crypto_pwhash`) and
 * XChaCha20-Poly1305 (`crypto_aead_xchacha20poly1305_ietf_*`).
 *
 * The load is dynamic so the ~1 MB WASM bundle is fetched when the first crypto
 * call happens rather than at app start.
 */
export type SodiumApi = (typeof import('libsodium-wrappers-sumo'))['default']

let loadPromise: Promise<SodiumApi> | null = null

export function getSodium(): Promise<SodiumApi> {
  if (!loadPromise) {
    loadPromise = import('libsodium-wrappers-sumo').then(async (module) => {
      const sodium = module.default
      await sodium.ready
      return sodium
    })
  }
  return loadPromise
}

/** True once libsodium has been requested (used by tests and diagnostics). */
export function isSodiumLoaded(): boolean {
  return loadPromise !== null
}
