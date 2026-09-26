import {
  base64UrlToBytes,
  bytesEqual,
  bytesToBase64Url,
  bytesToUtf8,
  isUint8Array,
  utf8ToBytes,
} from './encoding'
import {
  DecryptionFailedError,
  InvalidKeyMaterialError,
  InvalidParameterError,
  MalformedPayloadError,
} from './errors'
import { randomBytes } from './random'
import { getSodium } from './sodium'

export const AEAD_KEY_BYTES = 32
export const AEAD_NONCE_BYTES = 24
export const AEAD_TAG_BYTES = 16

/**
 * Version tag for the serialized envelope. Bump it (and keep opening old
 * versions) rather than silently changing the layout.
 */
export const SEALED_ENVELOPE_VERSION = 'oc1'

const ENVELOPE_PARTS = 4
const NO_AAD_MARKER = '-'

export type AadInput = string | Uint8Array | null | undefined

export interface SealedBox {
  readonly nonce: Uint8Array
  readonly ciphertext: Uint8Array
  readonly aad: Uint8Array | null
}

export interface SealOptions {
  /** Explicit nonce (tests, and callers that need a reproducible output). */
  readonly nonce?: Uint8Array
  /** Associated data: authenticated but not encrypted. */
  readonly aad?: AadInput
}

export interface OpenOptions {
  /**
   * Associated data the caller expects. When set, the envelope's own copy is
   * compared in constant time before decryption, so a record cannot be moved
   * into a different context (another chat, another vault field).
   */
  readonly expectedAad?: AadInput
}

/** XChaCha20-Poly1305 seal. A fresh 24-byte nonce is generated unless supplied. */
export async function seal(
  key: Uint8Array,
  plaintext: Uint8Array,
  options: SealOptions = {},
): Promise<SealedBox> {
  assertAeadKey(key)

  if (!isUint8Array(plaintext)) {
    throw new InvalidParameterError('plaintext must be a Uint8Array')
  }

  const nonce = options.nonce ?? randomBytes(AEAD_NONCE_BYTES)
  if (nonce.length !== AEAD_NONCE_BYTES) {
    throw new InvalidParameterError(
      `nonce must be ${AEAD_NONCE_BYTES} bytes, received ${nonce.length}`,
    )
  }

  const aad = toAadBytes(options.aad)
  const sodium = await getSodium()
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key,
  )

  return { nonce, ciphertext, aad }
}

/**
 * XChaCha20-Poly1305 open. Any failure (tampered ciphertext, tampered nonce,
 * wrong key, wrong/missing context) throws `DecryptionFailedError` — callers
 * cannot tell the cases apart, and neither can an attacker.
 */
export async function open(
  key: Uint8Array,
  box: SealedBox,
  options: OpenOptions = {},
): Promise<Uint8Array> {
  assertAeadKey(key)

  if (!isUint8Array(box.nonce) || box.nonce.length !== AEAD_NONCE_BYTES) {
    throw new InvalidParameterError(`nonce must be ${AEAD_NONCE_BYTES} bytes`)
  }

  if (!isUint8Array(box.ciphertext)) {
    throw new InvalidParameterError('ciphertext must be a Uint8Array')
  }

  if (box.ciphertext.length < AEAD_TAG_BYTES) {
    throw new DecryptionFailedError('ciphertext is shorter than the authentication tag')
  }

  const expectedAad = toAadBytes(options.expectedAad)
  if (expectedAad) {
    if (!box.aad || !(await bytesEqual(box.aad, expectedAad))) {
      throw new DecryptionFailedError('associated data does not match the expected context')
    }
  }

  const sodium = await getSodium()

  try {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      box.ciphertext,
      box.aad,
      box.nonce,
      key,
    )
  } catch {
    throw new DecryptionFailedError()
  }
}

/**
 * Seals into a self-describing string: `oc1.<nonce>.<aad|->.<ciphertext>`,
 * all unpadded URL-safe base64. This is what the vault stores and what travels
 * over Waku.
 */
export async function sealToEnvelope(
  key: Uint8Array,
  plaintext: Uint8Array,
  options: SealOptions = {},
): Promise<string> {
  const box = await seal(key, plaintext, options)
  const [nonce, aad, ciphertext] = await Promise.all([
    bytesToBase64Url(box.nonce),
    box.aad ? bytesToBase64Url(box.aad) : Promise.resolve(NO_AAD_MARKER),
    bytesToBase64Url(box.ciphertext),
  ])

  return [SEALED_ENVELOPE_VERSION, nonce, aad, ciphertext].join('.')
}

export async function openEnvelope(
  key: Uint8Array,
  envelope: string,
  options: OpenOptions = {},
): Promise<Uint8Array> {
  if (typeof envelope !== 'string') {
    throw new MalformedPayloadError('sealed envelope must be a string')
  }

  const parts = envelope.split('.')
  if (parts.length !== ENVELOPE_PARTS) {
    throw new MalformedPayloadError(
      `sealed envelope must have ${ENVELOPE_PARTS} dot-separated parts, received ${parts.length}`,
    )
  }

  const [version, noncePart, aadPart, ciphertextPart] = parts
  if (version !== SEALED_ENVELOPE_VERSION) {
    throw new MalformedPayloadError(`unsupported sealed envelope version "${String(version)}"`)
  }

  const nonce = await base64UrlToBytes(noncePart)
  const aad = aadPart === NO_AAD_MARKER ? null : await base64UrlToBytes(aadPart)
  const ciphertext = await base64UrlToBytes(ciphertextPart)

  return open(key, { nonce, ciphertext, aad }, options)
}

/** Seals UTF-8 text and returns the envelope string. */
export async function sealText(
  key: Uint8Array,
  text: string,
  options: SealOptions = {},
): Promise<string> {
  return sealToEnvelope(key, utf8ToBytes(text), options)
}

export async function openText(
  key: Uint8Array,
  envelope: string,
  options: OpenOptions = {},
): Promise<string> {
  return bytesToUtf8(await openEnvelope(key, envelope, options))
}

/** Seals any JSON-serializable value. */
export async function sealJson(
  key: Uint8Array,
  value: unknown,
  options: SealOptions = {},
): Promise<string> {
  return sealText(key, JSON.stringify(value), options)
}

export async function openJson<T>(
  key: Uint8Array,
  envelope: string,
  options: OpenOptions = {},
): Promise<T> {
  const text = await openText(key, envelope, options)

  try {
    return JSON.parse(text) as T
  } catch {
    throw new MalformedPayloadError('decrypted payload is not valid JSON')
  }
}

function toAadBytes(aad: AadInput): Uint8Array | null {
  if (aad === null || aad === undefined) return null
  return typeof aad === 'string' ? utf8ToBytes(aad) : aad
}

function assertAeadKey(key: Uint8Array): void {
  if (!isUint8Array(key) || key.length !== AEAD_KEY_BYTES) {
    throw new InvalidKeyMaterialError(
      `AEAD key must be ${AEAD_KEY_BYTES} bytes, received ${isUint8Array(key) ? key.length : 'nothing'}`,
    )
  }
}
