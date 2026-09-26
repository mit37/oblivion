import { describe, expect, it } from 'vitest'

import {
  assertByteLength,
  base64UrlToBytes,
  bytesEqual,
  bytesToBase64Url,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from './encoding'
import { InvalidParameterError, MalformedPayloadError } from './errors'

describe('utf-8 helpers', () => {
  it('round-trips ASCII text', () => {
    expect(bytesToUtf8(utf8ToBytes('hello'))).toBe('hello')
  })

  it('round-trips multi-byte text and emoji', () => {
    const text = 'Ünïcøde — ✓ — 🔐 — 日本語'
    expect(bytesToUtf8(utf8ToBytes(text))).toBe(text)
  })

  it('refuses invalid UTF-8 instead of replacing bytes', () => {
    expect(() => bytesToUtf8(Uint8Array.from([0xff, 0xfe, 0xfd]))).toThrow()
  })
})

describe('hex helpers', () => {
  it('encodes lower-case hex without a prefix by default', () => {
    expect(bytesToHex(Uint8Array.from([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff')
  })

  it('adds a 0x prefix when asked', () => {
    expect(bytesToHex(Uint8Array.from([0xde, 0xad]), { prefix: true })).toBe('0xdead')
  })

  it('parses hex with and without a 0x prefix', () => {
    expect(hexToBytes('0xdead')).toEqual(Uint8Array.from([0xde, 0xad]))
    expect(hexToBytes('dead')).toEqual(Uint8Array.from([0xde, 0xad]))
  })

  it('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow(MalformedPayloadError)
  })

  it('rejects non-hex characters', () => {
    expect(() => hexToBytes('zz')).toThrow(MalformedPayloadError)
  })

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index)
    expect(hexToBytes(bytesToHex(all))).toEqual(all)
  })
})

describe('concatBytes', () => {
  it('concatenates chunks in order', () => {
    expect(concatBytes(Uint8Array.from([1, 2]), Uint8Array.from([3]))).toEqual(
      Uint8Array.from([1, 2, 3]),
    )
  })

  it('returns an empty array when given nothing', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0))
  })
})

describe('bytesEqual', () => {
  it('is true for equal arrays', async () => {
    expect(await bytesEqual(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))).toBe(true)
  })

  it('is false for different content of the same length', async () => {
    expect(await bytesEqual(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4]))).toBe(false)
  })

  it('is false for different lengths', async () => {
    expect(await bytesEqual(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 3]))).toBe(false)
  })
})

describe('assertByteLength', () => {
  it('accepts the expected length', () => {
    expect(() => assertByteLength(new Uint8Array(32), 32, 'key')).not.toThrow()
  })

  it('throws InvalidParameterError for the wrong length', () => {
    expect(() => assertByteLength(new Uint8Array(31), 32, 'key')).toThrow(InvalidParameterError)
  })

  it('throws for a value that is not a Uint8Array', () => {
    expect(() => assertByteLength('nope' as unknown as Uint8Array, 32, 'key')).toThrow(
      InvalidParameterError,
    )
  })
})

describe('base64url helpers', () => {
  it('round-trips arbitrary bytes', async () => {
    const bytes = Uint8Array.from({ length: 255 }, (_, index) => (index * 7) % 256)
    expect(await base64UrlToBytes(await bytesToBase64Url(bytes))).toEqual(bytes)
  })

  it('produces unpadded URL-safe output', async () => {
    expect(await bytesToBase64Url(Uint8Array.from([0xfb, 0xff, 0xfe]))).toBe('-__-')
    expect(await bytesToBase64Url(Uint8Array.from([0xff]))).toBe('_w')
  })

  it('rejects characters outside the URL-safe alphabet', async () => {
    await expect(base64UrlToBytes('%')).rejects.toThrow(MalformedPayloadError)
    await expect(base64UrlToBytes('a+b/c')).rejects.toThrow(MalformedPayloadError)
  })
})
