import type { KdfParams } from '../crypto/kdf'

/**
 * The only thing ever persisted. `envelope` is the sealed vault document and
 * `kdf.salt` is the Argon2id salt — no plaintext, no key, no mnemonic.
 */
export interface VaultRecord {
  readonly id: 'primary'
  readonly version: 1
  readonly kdf: KdfParams & { readonly saltHex: string }
  readonly envelope: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface VaultStorage {
  read(): Promise<VaultRecord | null>
  write(record: VaultRecord): Promise<void>
  clear(): Promise<void>
  /**
   * Every raw value in the store, for the "nothing is stored in plaintext"
   * test and for the `npm run verify` audit. Not used by the app itself.
   */
  rawRecords(): Promise<unknown[]>
}

export const VAULT_RECORD_ID = 'primary'
export const VAULT_RECORD_VERSION = 1

/** In-memory storage, used by tests and by the mock/demo mode. */
export class MemoryVaultStorage implements VaultStorage {
  private record: VaultRecord | null = null

  /** Number of writes, so tests can assert what was persisted and when. */
  writes = 0

  async read(): Promise<VaultRecord | null> {
    return this.record === null ? null : structuredClone(this.record)
  }

  async write(record: VaultRecord): Promise<void> {
    this.record = structuredClone(record)
    this.writes += 1
  }

  async clear(): Promise<void> {
    this.record = null
  }

  async rawRecords(): Promise<unknown[]> {
    return this.record === null ? [] : [structuredClone(this.record)]
  }
}
