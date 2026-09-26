import { InvalidParameterError, MalformedPayloadError } from './errors'
import { getSodium } from './sodium'

const HEX_PATTERN = /^[0-9a-fA-F]*$/

/**
 * Encodes text as UTF-8.
 *
 * The result is copied into this realm's `Uint8Array`: `TextEncoder` can hand
 * back a typed array from another realm (Node's, inside jsdom), and libsodium
 * rejects foreign arrays with `instanceof` checks.
 */
export function utf8ToBytes(text: string): Uint8Array {
  return new Uint8Array(new TextEncoder().encode(text))
}

/**
 * Realm-agnostic `Uint8Array` check. `instanceof` fails across realms (a
 * jsdom page and a Node `TextEncoder` disagree), so this uses the internal
 * `Object.prototype.toString` tag instead.
 */
export function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
  )
}

/** Copies any byte view into this realm's `Uint8Array`. */
export function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value)
}

/** Decodes UTF-8, throwing on invalid sequences instead of replacing them. */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Lower-case hex, optionally `0x`-prefixed. */
export function bytesToHex(bytes: Uint8Array, options: { prefix?: boolean } = {}): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return options.prefix ? `0x${hex}` : hex
}

/** Parses hex (with or without a `0x` prefix); rejects odd lengths and non-hex. */
export function hexToBytes(hex: string): Uint8Array {
  const value = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex

  if (value.length % 2 !== 0) {
    throw new MalformedPayloadError(
      `hex value must have an even number of characters, received ${value.length}`,
    )
  }

  if (!HEX_PATTERN.test(value)) {
    throw new MalformedPayloadError('hex value contains characters outside [0-9a-fA-F]')
  }

  const output = new Uint8Array(value.length / 2)
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return output
}

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

/**
 * Constant-time comparison, via libsodium's `memcmp`. Used for comparing
 * associated data and digests, where early-exit comparison would leak timing.
 */
export async function bytesEqual(left: Uint8Array, right: Uint8Array): Promise<boolean> {
  if (left.length !== right.length) return false
  const sodium = await getSodium()
  return sodium.memcmp(left, right)
}

export function assertByteLength(bytes: Uint8Array, expected: number, label: string): void {
  if (!isUint8Array(bytes)) {
    throw new InvalidParameterError(`${label} must be a Uint8Array`)
  }
  if (bytes.length !== expected) {
    throw new InvalidParameterError(`${label} must be ${expected} bytes, received ${bytes.length}`)
  }
}

/** URL-safe, unpadded base64 — the wire format for sealed envelopes and identities. */
export async function bytesToBase64Url(bytes: Uint8Array): Promise<string> {
  const sodium = await getSodium()
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING)
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/

export async function base64UrlToBytes(value: string): Promise<Uint8Array> {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new MalformedPayloadError('value is not valid unpadded URL-safe base64')
  }

  const sodium = await getSodium()
  try {
    return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING)
  } catch {
    throw new MalformedPayloadError('value is not valid unpadded URL-safe base64')
  }
}
