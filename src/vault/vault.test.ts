import { describe, expect, it } from 'vitest'

import { MalformedPayloadError } from '../crypto/errors'
import { KDF_PROFILES } from '../crypto/kdf'
import { isValidMnemonic } from '../crypto/keys'
import { FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import {
  UnusableRecordError,
  VaultExistsError,
  VaultLockedError,
  VaultNotFoundError,
  WeakPasswordError,
  WrongPasswordError,
} from './errors'
import { migrateDocument, type ContactRecord } from './schema'
import { MemoryVaultStorage, type VaultRecord } from './storage'
import { MIN_PASSWORD_LENGTH, Vault, assertPasswordStrength, type VaultOptions } from './vault'

const PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'an entirely different passphrase'
const TIMES = ['2026-09-25T10:00:00.000Z', '2026-09-25T11:00:00.000Z', '2026-09-25T12:00:00.000Z']

/** A clock that advances one step per call, so timestamps are predictable. */
function steppingClock(): () => Date {
  let index = 0
  return () => {
    const value = TIMES[Math.min(index, TIMES.length - 1)] ?? TIMES[0]!
    index += 1
    return new Date(value)
  }
}

function makeVault(overrides: Partial<VaultOptions> = {}): {
  vault: Vault
  storage: MemoryVaultStorage
} {
  const storage = new MemoryVaultStorage()
  const vault = new Vault({
    storage,
    kdfProfile: 'test',
    allowTestProfile: true,
    now: steppingClock(),
    ...overrides,
  })
  return { vault, storage }
}

const CONTACT: ContactRecord = {
  id: 'contact-1',
  label: 'Ada',
  identity: `oblivion1${'A'.repeat(44)}`,
  publicKey: `0x02${'ab'.repeat(32)}`,
  addedAt: TIMES[0]!,
}

async function readRecord(storage: MemoryVaultStorage): Promise<VaultRecord> {
  const record = await storage.read()
  if (!record) throw new Error('expected a stored record')
  return record
}

describe('vault lifecycle', () => {
  it('does not exist before creation', async () => {
    const { vault } = makeVault()
    expect(await vault.exists()).toBe(false)
  })

  it('exists after creation', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    expect(await vault.exists()).toBe(true)
  })

  it('creates a 12-word mnemonic by default', async () => {
    const { vault } = makeVault()
    const { mnemonic } = await vault.create(PASSWORD)
    expect(mnemonic.split(' ')).toHaveLength(12)
    expect(isValidMnemonic(mnemonic)).toBe(true)
  })

  it('creates a 24-word mnemonic when asked', async () => {
    const { vault } = makeVault({ wordCount: 24 })
    const { mnemonic } = await vault.create(PASSWORD)
    expect(mnemonic.split(' ')).toHaveLength(24)
  })

  it('leaves the vault unlocked after creation', async () => {
    const { vault } = makeVault()
    const { document } = await vault.create(PASSWORD)

    expect(vault.isUnlocked).toBe(true)
    expect(vault.getDocument()).toEqual(document)
  })

  it('throws when reading the document before creation', () => {
    const { vault } = makeVault()
    expect(() => vault.getDocument()).toThrow(VaultLockedError)
  })

  it('writes exactly one record', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    expect(await storage.rawRecords()).toHaveLength(1)
  })

  it('stores the KDF parameters and a 16-byte salt', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)

    const record = await readRecord(storage)
    expect(record.kdf.algorithm).toBe('argon2id')
    expect(record.kdf.opsLimit).toBe(KDF_PROFILES.test.opsLimit)
    expect(record.kdf.memLimitBytes).toBe(KDF_PROFILES.test.memLimitBytes)
    expect(record.kdf.saltHex).toMatch(/^[0-9a-f]{32}$/)
  })

  it('stores a sealed envelope, not JSON', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    expect(record.envelope.startsWith('oc1.')).toBe(true)
    expect(record.envelope).not.toContain('mnemonic')
    expect(() => JSON.parse(record.envelope)).toThrow()
  })

  it('stamps createdAt and updatedAt from the injected clock', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    expect(record.createdAt).toBe(TIMES[0])
    expect(record.updatedAt).toBe(TIMES[0])
    expect(record.id).toBe('primary')
    expect(record.version).toBe(1)
  })

  it('refuses to create a second vault over an existing one', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    await expect(vault.create(PASSWORD)).rejects.toThrow(VaultExistsError)
  })

  it('refuses a password below the minimum length', async () => {
    const { vault } = makeVault()
    await expect(vault.create('short')).rejects.toThrow(WeakPasswordError)
  })

  it('refuses a password that is not a string', async () => {
    const { vault } = makeVault()
    await expect(vault.create(undefined as unknown as string)).rejects.toThrow(WeakPasswordError)
  })

  it('stores the requested auto-lock timeout', async () => {
    const { vault } = makeVault({ autoLockMinutes: 60 })
    const { document } = await vault.create(PASSWORD)
    expect(document.settings.autoLockMinutes).toBe(60)
  })

  it('clamps an unsupported auto-lock timeout', async () => {
    const { vault } = makeVault({ autoLockMinutes: 3 })
    const { document } = await vault.create(PASSWORD)
    expect(document.settings.autoLockMinutes).toBe(15)
  })

  it('stores the requested address index', async () => {
    const { vault } = makeVault({ addressIndex: 4 })
    const { document } = await vault.create(PASSWORD)
    expect(document.settings.addressIndex).toBe(4)
  })
})

describe('unlock and lock', () => {
  it('unlocks with the right password and returns the same document', async () => {
    const { vault } = makeVault()
    const { document } = await vault.create(PASSWORD)
    vault.lock()

    // Unlock returns the migrated document: a test-profile vault reports the
    // interactive profile, because the weak profile is never kept in a document.
    expect(await vault.unlock(PASSWORD)).toEqual(migrateDocument(document))
  })

  it('never reports the weak test profile from a stored document', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    vault.lock()

    expect((await vault.unlock(PASSWORD)).settings.kdfProfile).toBe('interactive')
  })

  it('rejects a wrong password with a single typed error', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    vault.lock()

    await expect(vault.unlock('wrong password entirely')).rejects.toThrow(WrongPasswordError)
  })

  it('rejects unlocking when no vault exists', async () => {
    const { vault } = makeVault()
    await expect(vault.unlock(PASSWORD)).rejects.toThrow(VaultNotFoundError)
  })

  it('locks the vault and drops the document', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    vault.lock()

    expect(vault.isUnlocked).toBe(false)
    expect(() => vault.getDocument()).toThrow(VaultLockedError)
  })

  it('can be unlocked again after locking', async () => {
    const { vault } = makeVault()
    const { document } = await vault.create(PASSWORD)
    vault.lock()
    const reopened = await vault.unlock(PASSWORD)

    expect(vault.isUnlocked).toBe(true)
    expect(reopened.identity.mnemonic).toBe(document.identity.mnemonic)
  })

  it('refuses a record whose envelope was tampered with', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    const parts = record.envelope.split('.')
    parts[3] = `${parts[3]!.startsWith('A') ? 'B' : 'A'}${parts[3]!.slice(1)}`
    await storage.write({ ...record, envelope: parts.join('.') })
    vault.lock()

    await expect(vault.unlock(PASSWORD)).rejects.toThrow(WrongPasswordError)
  })

  it('refuses a record whose salt was swapped', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    await storage.write({ ...record, kdf: { ...record.kdf, saltHex: 'ff'.repeat(16) } })
    vault.lock()

    await expect(vault.unlock(PASSWORD)).rejects.toThrow(WrongPasswordError)
  })
})

describe('document updates', () => {
  it('requires an unlocked vault', async () => {
    const { vault } = makeVault()
    await expect(vault.update((document) => document)).rejects.toThrow(VaultLockedError)
  })

  it('persists an edit across a lock and unlock cycle', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)

    await vault.update((document) => ({ ...document, contacts: [CONTACT] }))
    vault.lock()
    const reopened = await vault.unlock(PASSWORD)

    expect(reopened.contacts).toHaveLength(1)
    expect(reopened.contacts[0]?.label).toBe('Ada')
  })

  it('bumps updatedAt but keeps createdAt', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    await vault.update((document) => ({ ...document, contacts: [CONTACT] }))

    const record = await readRecord(storage)
    expect(record.createdAt).toBe(TIMES[0])
    expect(record.updatedAt).toBe(TIMES[1])
  })

  it('refuses to persist a document that fails validation', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)

    await expect(
      vault.update((document) => ({
        ...document,
        identity: { ...document.identity, mnemonic: 'not a mnemonic' },
      })),
    ).rejects.toThrow(MalformedPayloadError)
  })

  it('leaves the previous document intact when a write fails', async () => {
    const { vault } = makeVault()
    const { document } = await vault.create(PASSWORD)

    await expect(
      vault.update((current) => ({ ...current, contacts: [{ id: 'broken' } as ContactRecord] })),
    ).rejects.toThrow(MalformedPayloadError)

    expect(vault.getDocument()).toEqual(document)
  })
})

describe('password re-wrap', () => {
  it('makes the old password stop working', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    await vault.changePassword(PASSWORD, NEW_PASSWORD)
    vault.lock()

    await expect(vault.unlock(PASSWORD)).rejects.toThrow(WrongPasswordError)
  })

  it('opens with the new password and keeps the mnemonic', async () => {
    const { vault } = makeVault()
    const { document } = await vault.create(PASSWORD)
    await vault.changePassword(PASSWORD, NEW_PASSWORD)
    vault.lock()

    const reopened = await vault.unlock(NEW_PASSWORD)
    expect(reopened.identity.mnemonic).toBe(document.identity.mnemonic)
  })

  it('rotates the salt', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const before = await readRecord(storage)

    await vault.changePassword(PASSWORD, NEW_PASSWORD)
    const after = await readRecord(storage)

    expect(after.kdf.saltHex).not.toBe(before.kdf.saltHex)
    expect(after.envelope).not.toBe(before.envelope)
  })

  it('keeps createdAt and bumps updatedAt', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    await vault.changePassword(PASSWORD, NEW_PASSWORD)
    const record = await readRecord(storage)

    expect(record.createdAt).toBe(TIMES[0])
    expect(record.updatedAt).toBe(TIMES[1])
  })

  it('requires the current password even while unlocked', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)

    await expect(vault.changePassword('not the current one', NEW_PASSWORD)).rejects.toThrow(
      WrongPasswordError,
    )
  })

  it('refuses a weak new password', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)

    await expect(vault.changePassword(PASSWORD, 'short')).rejects.toThrow(WeakPasswordError)
  })

  it('leaves the vault unlocked under the new key', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    await vault.changePassword(PASSWORD, NEW_PASSWORD)

    expect(vault.isUnlocked).toBe(true)
    expect(vault.getDocument().identity.wordCount).toBe(12)
  })
})

describe('destroy', () => {
  it('removes the record and locks', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    await vault.destroy()

    expect(await vault.exists()).toBe(false)
    expect(await storage.rawRecords()).toEqual([])
    expect(vault.isUnlocked).toBe(false)
  })
})

describe('record parameter guards', () => {
  it('refuses a record whose ops limit was weakened', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    await storage.write({
      ...record,
      kdf: { ...record.kdf, opsLimit: 1, memLimitBytes: 64 * 1024 * 1024 },
    })
    vault.lock()

    // A production-configured vault is the one that must refuse the downgrade.
    const production = new Vault({ storage, now: steppingClock() })
    await expect(production.unlock(PASSWORD)).rejects.toThrow(UnusableRecordError)
  })

  it('refuses a record with parameters below the libsodium floor', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    await storage.write({ ...record, kdf: { ...record.kdf, memLimitBytes: 1024 } })
    vault.lock()

    const production = new Vault({ storage, now: steppingClock() })
    await expect(production.unlock(PASSWORD)).rejects.toThrow(UnusableRecordError)
  })

  it('refuses a record with an unknown algorithm', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    const record = await readRecord(storage)

    await storage.write({ ...record, kdf: { ...record.kdf, algorithm: 'scrypt' as never } })
    vault.lock()

    await expect(vault.unlock(PASSWORD)).rejects.toThrow(UnusableRecordError)
  })

  it('refuses to open a test-profile vault with production settings', async () => {
    const { vault, storage } = makeVault()
    await vault.create(PASSWORD)
    vault.lock()

    const production = new Vault({ storage })
    await expect(production.unlock(PASSWORD)).rejects.toThrow(UnusableRecordError)
  })

  it('defaults to the interactive profile with the full Argon2id work', async () => {
    // This is the slow test on purpose: it is the profile real users get.
    const storage = new MemoryVaultStorage()
    const vault = new Vault({ storage, now: steppingClock() })
    await vault.create(PASSWORD)

    const record = await readRecord(storage)
    expect(record.kdf.opsLimit).toBe(KDF_PROFILES.interactive.opsLimit)
    expect(record.kdf.memLimitBytes).toBe(KDF_PROFILES.interactive.memLimitBytes)
    expect(vault.getDocument().settings.kdfProfile).toBe('interactive')
  })
})

describe('assertPasswordStrength', () => {
  it('accepts a password exactly at the minimum length', () => {
    expect(() => assertPasswordStrength('x'.repeat(MIN_PASSWORD_LENGTH))).not.toThrow()
  })

  it('rejects a password one character short', () => {
    expect(() => assertPasswordStrength('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toThrow(
      WeakPasswordError,
    )
  })

  it('requires at least eight characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8)
  })
})

describe('vaults restored from a known mnemonic', () => {
  it('can be restored from the published mnemonic after a re-wrap', async () => {
    const { vault } = makeVault()
    await vault.create(PASSWORD)
    await vault.update((document) => ({
      ...document,
      identity: { ...document.identity, mnemonic: FIRST_BIP39_TEST_MNEMONIC },
    }))
    await vault.changePassword(PASSWORD, NEW_PASSWORD)
    vault.lock()

    const reopened = await vault.unlock(NEW_PASSWORD)
    expect(reopened.identity.mnemonic).toBe(FIRST_BIP39_TEST_MNEMONIC)
  })
})
