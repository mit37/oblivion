import { InvalidParameterError } from './errors'

/**
 * WebCrypto caps one `getRandomValues` call at 65 536 bytes; larger requests
 * are filled in chunks so the limit never shows up as a silent truncation.
 */
const MAX_BYTES_PER_CALL = 65_536

/**
 * All randomness in Oblivion comes from WebCrypto's CSPRNG — salts, AEAD
 * nonces and anything the vault needs. libsodium is used only for the KDF and
 * the AEAD, which keeps the entropy story to one reviewed source.
 */
export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new InvalidParameterError(
      `randomBytes length must be a non-negative integer, received ${length}`,
    )
  }

  const output = new Uint8Array(length)

  for (let offset = 0; offset < length; offset += MAX_BYTES_PER_CALL) {
    const size = Math.min(MAX_BYTES_PER_CALL, length - offset)
    const chunk = new Uint8Array(size)
    getRandomValues(chunk)
    output.set(chunk, offset)
  }

  return output
}

function getRandomValues(target: Uint8Array): void {
  const webcrypto: Crypto | undefined = globalThis.crypto

  if (!webcrypto || typeof webcrypto.getRandomValues !== 'function') {
    throw new InvalidParameterError(
      'WebCrypto crypto.getRandomValues is unavailable, so no secure randomness can be produced',
    )
  }

  webcrypto.getRandomValues(target)
}
