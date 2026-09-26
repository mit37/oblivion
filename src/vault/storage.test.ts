import 'fake-indexeddb/auto'

import { describe, expect, it } from 'vitest'

import { IndexedDbVaultStorage } from './storage-idb'
import {
  MemoryVaultStorage,
  VAULT_RECORD_ID,
  VAULT_RECORD_VERSION,
  type VaultRecord,
} from './storage'

const RECORD: VaultRecord = {
  id: VAULT_RECORD_ID,
  version: VAULT_RECORD_VERSION,
  kdf: {
    algorithm: 'argon2id',
    opsLimit: 3,
    memLimitBytes: 64 * 1024 * 1024,
    saltHex: 'ab'.repeat(16),
  },
  envelope: 'oc1.nonce.aad.ciphertext',
  createdAt: '2026-09-25T10:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
}

describe('MemoryVaultStorage', () => {
  it('starts empty', async () => {
    expect(await new MemoryVaultStorage().read()).toBeNull()
  })

  it('writes and reads a record', async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(RECORD)
    expect(await storage.read()).toEqual(RECORD)
  })

  it('counts writes', async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(RECORD)
    await storage.write({ ...RECORD, envelope: 'oc1.other.aad.ciphertext' })
    expect(storage.writes).toBe(2)
  })

  it('hands out copies, so callers cannot mutate the stored record', async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(RECORD)

    const first = (await storage.read()) as { envelope: string } | null
    if (!first) throw new Error('expected a record')
    first.envelope = 'tampered'

    expect((await storage.read())?.envelope).toBe(RECORD.envelope)
  })

  it('clears the record', async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(RECORD)
    await storage.clear()
    expect(await storage.read()).toBeNull()
    expect(await storage.rawRecords()).toEqual([])
  })

  it('reports raw records for scanning', async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(RECORD)
    expect(await storage.rawRecords()).toEqual([RECORD])
  })
})

describe('IndexedDbVaultStorage', () => {
  it('starts empty', async () => {
    const storage = new IndexedDbVaultStorage('oblivion-test-empty')
    expect(await storage.read()).toBeNull()
    await storage.close()
  })

  it('writes and reads a record', async () => {
    const storage = new IndexedDbVaultStorage('oblivion-test-roundtrip')
    await storage.write(RECORD)
    expect(await storage.read()).toEqual(RECORD)
    await storage.close()
  })

  it('overwrites the single record instead of appending', async () => {
    const storage = new IndexedDbVaultStorage('oblivion-test-overwrite')
    await storage.write(RECORD)
    const next = { ...RECORD, envelope: 'oc1.new.aad.ciphertext' }
    await storage.write(next)

    expect(await storage.rawRecords()).toHaveLength(1)
    expect((await storage.read())?.envelope).toBe(next.envelope)
    await storage.close()
  })

  it('clears the store', async () => {
    const storage = new IndexedDbVaultStorage('oblivion-test-clear')
    await storage.write(RECORD)
    await storage.clear()
    expect(await storage.read()).toBeNull()
    await storage.close()
  })

  it('exposes raw records for the plaintext scan', async () => {
    const storage = new IndexedDbVaultStorage('oblivion-test-raw')
    await storage.write(RECORD)
    expect(await storage.rawRecords()).toEqual([RECORD])
    await storage.close()
  })

  it('persists across connections to the same database', async () => {
    const first = new IndexedDbVaultStorage('oblivion-test-persist')
    await first.write(RECORD)
    await first.close()

    const second = new IndexedDbVaultStorage('oblivion-test-persist')
    expect(await second.read()).toEqual(RECORD)
    await second.close()
  })
})
