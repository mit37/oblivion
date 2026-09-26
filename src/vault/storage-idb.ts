import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { VAULT_RECORD_ID, type VaultRecord, type VaultStorage } from './storage'

export const VAULT_DB_NAME = 'oblivion-vault'
export const VAULT_DB_VERSION = 1
export const VAULT_STORE_NAME = 'vault'

interface OblivionDb extends DBSchema {
  [VAULT_STORE_NAME]: {
    key: string
    value: VaultRecord
  }
}

/**
 * IndexedDB storage for the single vault record.
 *
 * Only the sealed record is ever written: see `rawRecords`, which the test
 * suite scans to prove no plaintext reaches the database.
 */
export class IndexedDbVaultStorage implements VaultStorage {
  private connection: Promise<IDBPDatabase<OblivionDb>> | null = null

  constructor(private readonly databaseName: string = VAULT_DB_NAME) {}

  private getDatabase(): Promise<IDBPDatabase<OblivionDb>> {
    if (!this.connection) {
      this.connection = openDB<OblivionDb>(this.databaseName, VAULT_DB_VERSION, {
        upgrade(database) {
          if (!database.objectStoreNames.contains(VAULT_STORE_NAME)) {
            database.createObjectStore(VAULT_STORE_NAME)
          }
        },
      })
    }
    return this.connection
  }

  async read(): Promise<VaultRecord | null> {
    const database = await this.getDatabase()
    return (await database.get(VAULT_STORE_NAME, VAULT_RECORD_ID)) ?? null
  }

  async write(record: VaultRecord): Promise<void> {
    const database = await this.getDatabase()
    await database.put(VAULT_STORE_NAME, record, VAULT_RECORD_ID)
  }

  async clear(): Promise<void> {
    const database = await this.getDatabase()
    await database.clear(VAULT_STORE_NAME)
  }

  async rawRecords(): Promise<unknown[]> {
    const database = await this.getDatabase()
    return database.getAll(VAULT_STORE_NAME)
  }

  /** Closes the connection (used by tests and by "forget this device"). */
  async close(): Promise<void> {
    if (this.connection) {
      const database = await this.connection
      database.close()
      this.connection = null
    }
  }
}
