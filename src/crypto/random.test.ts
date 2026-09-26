import { describe, expect, it } from 'vitest'

import { InvalidParameterError } from './errors'
import { randomBytes } from './random'

describe('randomBytes', () => {
  it('returns the requested number of bytes', () => {
    expect(randomBytes(32)).toHaveLength(32)
  })

  it('returns an empty array for length zero', () => {
    expect(randomBytes(0)).toHaveLength(0)
  })

  it('returns different bytes on each call', () => {
    const seen = new Set(
      Array.from({ length: 32 }, () => Buffer.from(randomBytes(16)).toString('hex')),
    )
    expect(seen.size).toBe(32)
  })

  it('fills requests larger than one WebCrypto chunk', () => {
    const bytes = randomBytes(70_000)
    expect(bytes).toHaveLength(70_000)
    expect(bytes.slice(65_530).some((byte) => byte !== 0)).toBe(true)
  })

  it('rejects a negative length', () => {
    expect(() => randomBytes(-1)).toThrow(InvalidParameterError)
  })

  it('rejects a non-integer length', () => {
    expect(() => randomBytes(1.5)).toThrow(InvalidParameterError)
  })
})
