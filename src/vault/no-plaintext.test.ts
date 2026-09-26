import 'fake-indexeddb/auto'

import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'

import { base64UrlToBytes } from '../crypto/encoding'
import { deriveMessagingIdentity, deriveWalletAccount } from '../crypto/keys'
import { VAULT_STORE_NAME, IndexedDbVaultStorage, VAULT_DB_NAME } from './storage-idb'
import type { VaultRecord } from './storage'
import { Vault } from './vault'

const PASSWORD = 'correct horse battery staple'

/**
 * The PRD requires proof that nothing sensitive reaches storage. These tests
 * scan the actual IndexedDB contents written by the real storage class, and
 * include a control that shows the scan would have caught a leak.
 */
async function createVault(databaseName: string) {
  const storage = new IndexedDbVaultStorage(databaseName)
  const vault = new Vault({ storage, kdfProfile: 'test', allowTestProfile: true })
  const { document, mnemonic } = await vault.create(PASSWORD)

  const raw = (await storage.rawRecords()) as VaultRecord[]
  const record = raw[0]
  if (!record) throw new Error('expected a stored record')

  return { storage, vault, document, mnemonic, record, raw }
}

describe('nothing sensitive is stored in plaintext', () => {
  it('does not store the password anywhere in the record', async () => {
    const { record } = await createVault('oblivion-plain-password')
    expect(JSON.stringify(record)).not.toContain(PASSWORD)
  })

  it('does not store the mnemonic', async () => {
    const { record, mnemonic } = await createVault('oblivion-plain-mnemonic')
    expect(JSON.stringify(record)).not.toContain(mnemonic)
    expect(JSON.stringify(record)).not.toContain('abandon abandon')
  })

  it('does not store the word "mnemonic" or other structure hints', async () => {
    const { record } = await createVault('oblivion-plain-hints')
    const serialized = JSON.stringify(record)
    for (const hint of ['mnemonic', 'identity', 'contacts', 'messages', 'schemaVersion']) {
      expect(serialized).not.toContain(hint)
    }
  })

  it('does not store derived keys or addresses', async () => {
    const { record, mnemonic } = await createVault('oblivion-plain-keys')
    const serialized = JSON.stringify(record)
    const wallet = deriveWalletAccount(mnemonic)
    const messaging = deriveMessagingIdentity(mnemonic)

    expect(serialized).not.toContain(wallet.privateKey)
    expect(serialized).not.toContain(messaging.privateKey)
    expect(serialized.toLowerCase()).not.toContain(wallet.address.toLowerCase())
    expect(serialized.toLowerCase()).not.toContain(messaging.publicKey.toLowerCase())
  })

  it('stores only fields that are opaque or non-secret', async () => {
    const { record } = await createVault('oblivion-plain-fields')

    expect(Object.keys(record).sort()).toEqual(
      ['createdAt', 'envelope', 'id', 'kdf', 'updatedAt', 'version'].sort(),
    )
    expect(Object.keys(record.kdf).sort()).toEqual(
      ['algorithm', 'memLimitBytes', 'opsLimit', 'saltHex'].sort(),
    )
  })

  it('keeps the sealed payload opaque', async () => {
    const { record, mnemonic } = await createVault('oblivion-plain-envelope')
    const parts = record.envelope.split('.')
    const ciphertextPart = parts[3] ?? ''

    const ciphertext = await base64UrlToBytes(ciphertextPart)
    const asLatin1 = Array.from(ciphertext)
      .map((byte) => String.fromCharCode(byte))
      .join('')

    expect(asLatin1).not.toContain(PASSWORD)
    expect(asLatin1).not.toContain(mnemonic)
    expect(asLatin1).not.toContain('mnemonic')
  })

  it('stores the mnemonic inside the sealed payload (control for the scan)', async () => {
    const { document, mnemonic } = await createVault('oblivion-plain-control')
    expect(document.identity.mnemonic).toBe(mnemonic)
  })

  it('uses one database with one store and exactly one record', async () => {
    const databaseName = 'oblivion-plain-shape'
    await createVault(databaseName)

    const database = await openDB(databaseName)
    expect(Array.from(database.objectStoreNames)).toEqual([VAULT_STORE_NAME])
    expect(await database.getAll(VAULT_STORE_NAME)).toHaveLength(1)
    database.close()
  })

  it('keeps the default database name stable for the app', () => {
    expect(VAULT_DB_NAME).toBe('oblivion-vault')
  })

  it('stores no plaintext after an update and a re-wrap', async () => {
    const { storage, vault, mnemonic } = await createVault('oblivion-plain-rewrap')

    await vault.update((document) => ({ ...document, contacts: [] }))
    await vault.changePassword(PASSWORD, 'a second, longer password')

    const serialized = JSON.stringify(await storage.rawRecords())
    expect(serialized).not.toContain(PASSWORD)
    expect(serialized).not.toContain('a second, longer password')
    expect(serialized).not.toContain(mnemonic)
  })
})
