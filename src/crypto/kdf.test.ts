import { describe, expect, it } from 'vitest'

import { bytesToHex, hexToBytes } from './encoding'
import { InvalidKeyMaterialError, InvalidParameterError } from './errors'
import {
  ARGON2ID_ALGORITHM,
  KDF_PROFILES,
  KDF_SALT_BYTES,
  MAX_MEM_LIMIT_BYTES,
  MIN_MEM_LIMIT_BYTES,
  VAULT_KEY_BYTES,
  assertKdfParams,
  deriveVaultKey,
  describeKdfProfile,
  randomSalt,
} from './kdf'
import { KDF_REGRESSION_VECTORS } from './vectors'

/** The weak profile is only reachable with an explicit opt-in (tests/CI only). */
const TEST_OPTIONS = { allowTestProfile: true } as const
const PASSWORD = 'correct horse battery staple'
const SALT = hexToBytes('000102030405060708090a0b0c0d0e0f')

const testProfileVector = KDF_REGRESSION_VECTORS.find((vector) => vector.profile === 'test')
const interactiveVector = KDF_REGRESSION_VECTORS.find((vector) => vector.profile === 'interactive')

describe('randomSalt', () => {
  it('returns exactly the Argon2id salt size', () => {
    expect(randomSalt()).toHaveLength(KDF_SALT_BYTES)
  })

  it('returns a different salt on every call', () => {
    const salts = new Set(Array.from({ length: 64 }, () => bytesToHex(randomSalt())))
    expect(salts.size).toBe(64)
  })

  it('never returns an all-zero salt', () => {
    expect(bytesToHex(randomSalt())).not.toBe('0'.repeat(KDF_SALT_BYTES * 2))
  })
})

describe('deriveVaultKey', () => {
  it('returns a 32-byte key', async () => {
    const key = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    expect(key).toHaveLength(VAULT_KEY_BYTES)
  })

  it('is deterministic for the same password, salt and parameters', async () => {
    const first = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    const second = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    expect(bytesToHex(first)).toBe(bytesToHex(second))
  })

  it('changes when the password changes', async () => {
    const first = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    const second = await deriveVaultKey(`${PASSWORD}!`, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    expect(bytesToHex(first)).not.toBe(bytesToHex(second))
  })

  it('changes when the salt changes', async () => {
    const otherSalt = hexToBytes('0f0e0d0c0b0a09080706050403020100')
    const first = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    const second = await deriveVaultKey(PASSWORD, otherSalt, KDF_PROFILES.test, TEST_OPTIONS)
    expect(bytesToHex(first)).not.toBe(bytesToHex(second))
  })

  it('changes when the ops limit changes', async () => {
    const first = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    const second = await deriveVaultKey(
      PASSWORD,
      SALT,
      { ...KDF_PROFILES.test, opsLimit: 2 },
      TEST_OPTIONS,
    )
    expect(bytesToHex(first)).not.toBe(bytesToHex(second))
  })

  it('changes when the memory limit changes', async () => {
    const first = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    const second = await deriveVaultKey(
      PASSWORD,
      SALT,
      { ...KDF_PROFILES.test, memLimitBytes: 16 * 1024 * 1024 },
      TEST_OPTIONS,
    )
    expect(bytesToHex(first)).not.toBe(bytesToHex(second))
  })

  it('matches the committed regression vector for the test profile', async () => {
    expect(testProfileVector).toBeDefined()
    const key = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test, TEST_OPTIONS)
    expect(bytesToHex(key)).toBe(testProfileVector?.keyHex)
  })

  it('matches the committed regression vector for the interactive profile', async () => {
    expect(interactiveVector).toBeDefined()
    const key = await deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.interactive)
    expect(bytesToHex(key)).toBe(interactiveVector?.keyHex)
  })

  it('accepts a unicode password with spaces', async () => {
    const first = await deriveVaultKey(
      'correct 🐄 battery — staple',
      SALT,
      KDF_PROFILES.test,
      TEST_OPTIONS,
    )
    const second = await deriveVaultKey(
      'correct 🐄 battery — staple',
      SALT,
      KDF_PROFILES.test,
      TEST_OPTIONS,
    )
    expect(bytesToHex(first)).toBe(bytesToHex(second))
  })

  it('rejects an empty password', async () => {
    await expect(deriveVaultKey('', SALT, KDF_PROFILES.test, TEST_OPTIONS)).rejects.toThrow(
      InvalidKeyMaterialError,
    )
  })

  it('rejects a non-string password', async () => {
    await expect(
      deriveVaultKey(undefined as unknown as string, SALT, KDF_PROFILES.test, TEST_OPTIONS),
    ).rejects.toThrow(InvalidKeyMaterialError)
  })

  it('rejects a salt that is one byte too short', async () => {
    await expect(
      deriveVaultKey(PASSWORD, new Uint8Array(15), KDF_PROFILES.test, TEST_OPTIONS),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects a salt that is one byte too long', async () => {
    await expect(
      deriveVaultKey(PASSWORD, new Uint8Array(17), KDF_PROFILES.test, TEST_OPTIONS),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects a salt that is not a Uint8Array', async () => {
    await expect(
      deriveVaultKey(PASSWORD, 'salt' as unknown as Uint8Array, KDF_PROFILES.test, TEST_OPTIONS),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects an unknown algorithm', async () => {
    await expect(
      deriveVaultKey(
        PASSWORD,
        SALT,
        { ...KDF_PROFILES.test, algorithm: 'scrypt' as never },
        TEST_OPTIONS,
      ),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects an ops limit of zero', async () => {
    await expect(
      deriveVaultKey(PASSWORD, SALT, { ...KDF_PROFILES.test, opsLimit: 0 }, TEST_OPTIONS),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects a non-integer ops limit', async () => {
    await expect(
      deriveVaultKey(PASSWORD, SALT, { ...KDF_PROFILES.test, opsLimit: 1.5 }, TEST_OPTIONS),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects a memory limit below libsodium\u2019s floor', async () => {
    await expect(
      deriveVaultKey(PASSWORD, SALT, { ...KDF_PROFILES.test, memLimitBytes: 1024 }, TEST_OPTIONS),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('rejects an absurd memory limit up front', async () => {
    await expect(
      deriveVaultKey(
        PASSWORD,
        SALT,
        { ...KDF_PROFILES.test, memLimitBytes: MAX_MEM_LIMIT_BYTES * 2 },
        TEST_OPTIONS,
      ),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('refuses the weak test profile without the explicit test opt-in', async () => {
    await expect(deriveVaultKey(PASSWORD, SALT, KDF_PROFILES.test)).rejects.toThrow(
      InvalidParameterError,
    )
  })

  it('refuses weaker-than-interactive parameters by default', async () => {
    await expect(
      deriveVaultKey(PASSWORD, SALT, { ...KDF_PROFILES.interactive, opsLimit: 2 }),
    ).rejects.toThrow(InvalidParameterError)
  })

  it('accepts the sensitive profile by default', () => {
    expect(() => assertKdfParams(KDF_PROFILES.sensitive)).not.toThrow()
  })
})

describe('KDF_PROFILES', () => {
  it('labels every profile as argon2id', () => {
    for (const profile of Object.values(KDF_PROFILES)) {
      expect(profile.algorithm).toBe(ARGON2ID_ALGORITHM)
    }
  })

  it('keeps the interactive profile at 64 MiB and at least 3 passes', () => {
    expect(KDF_PROFILES.interactive.memLimitBytes).toBeGreaterThanOrEqual(64 * 1024 * 1024)
    expect(KDF_PROFILES.interactive.opsLimit).toBeGreaterThanOrEqual(3)
  })

  it('makes the sensitive profile strictly more expensive than interactive', () => {
    expect(KDF_PROFILES.sensitive.memLimitBytes).toBeGreaterThan(
      KDF_PROFILES.interactive.memLimitBytes,
    )
    expect(KDF_PROFILES.sensitive.opsLimit).toBeGreaterThan(KDF_PROFILES.interactive.opsLimit)
  })

  it('keeps the test profile above libsodium\u2019s floor only for tests', () => {
    expect(KDF_PROFILES.test.memLimitBytes).toBeGreaterThanOrEqual(MIN_MEM_LIMIT_BYTES)
    expect(KDF_PROFILES.test.memLimitBytes).toBeLessThan(KDF_PROFILES.interactive.memLimitBytes)
  })
})

describe('describeKdfProfile', () => {
  it('renders the interactive profile for humans', () => {
    expect(describeKdfProfile('interactive')).toBe('Argon2id, 3 passes, 64 MiB memory')
  })

  it('renders the test profile with a singular pass', () => {
    expect(describeKdfProfile('test')).toBe('Argon2id, 1 pass, 8 MiB memory')
  })
})
