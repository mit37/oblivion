import { openJson, sealJson } from '../crypto/aead'
import { bytesToHex, hexToBytes } from '../crypto/encoding'
import { DecryptionFailedError, InvalidParameterError } from '../crypto/errors'
import {
  KDF_PROFILES,
  assertKdfParams,
  deriveVaultKey,
  randomSalt,
  type KdfParams,
  type KdfProfileName,
} from '../crypto/kdf'
import { generateMnemonic, type MnemonicWordCount } from '../crypto/keys'
import {
  UnusableRecordError,
  VaultExistsError,
  VaultLockedError,
  VaultNotFoundError,
  WeakPasswordError,
  WrongPasswordError,
} from './errors'
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  createEmptyDocument,
  migrateDocument,
  type VaultDocument,
} from './schema'
import {
  MemoryVaultStorage,
  VAULT_RECORD_ID,
  VAULT_RECORD_VERSION,
  type VaultRecord,
  type VaultStorage,
} from './storage'

export const MIN_PASSWORD_LENGTH = 8

/** Associated data binding a record to its salt and to this schema version. */
export const VAULT_AAD_PREFIX = 'oblivion/vault/v1'

export function vaultAssociatedData(saltHex: string): string {
  return `${VAULT_AAD_PREFIX}/${saltHex}`
}

export interface VaultOptions {
  readonly storage?: VaultStorage
  /** KDF profile for a *new* vault; stored in the record and reused on unlock. */
  readonly kdfProfile?: KdfProfileName
  readonly autoLockMinutes?: number
  readonly addressIndex?: number
  readonly wordCount?: MnemonicWordCount
  readonly now?: () => Date
  /**
   * Tests and the mock/demo mode only. Permits the deliberately weak `test` KDF
   * profile; the app never sets it, so a shipping build cannot pick it.
   */
  readonly allowTestProfile?: boolean
}

export interface CreatedVault {
  readonly document: VaultDocument
  /** Shown once, for the backup flow, and never again. */
  readonly mnemonic: string
}

/**
 * The vault: one password-derived key, one encrypted document, one record.
 *
 * Every method that needs the key throws `VaultLockedError` when the vault is
 * locked rather than falling back to anything weaker, and nothing but the
 * sealed record ever reaches storage.
 */
export class Vault {
  private readonly storage: VaultStorage
  private readonly options: VaultOptions
  private key: Uint8Array | null = null
  private document: VaultDocument | null = null

  constructor(options: VaultOptions = {}) {
    this.options = options
    this.storage = options.storage ?? new MemoryVaultStorage()
  }

  get isUnlocked(): boolean {
    return this.key !== null && this.document !== null
  }

  /** The decrypted document. Throws when locked. */
  getDocument(): VaultDocument {
    if (!this.document) {
      throw new VaultLockedError()
    }
    return this.document
  }

  async exists(): Promise<boolean> {
    return (await this.storage.read()) !== null
  }

  async create(password: string): Promise<CreatedVault> {
    assertPasswordStrength(password)

    if (await this.exists()) {
      throw new VaultExistsError()
    }

    const wordCount = this.options.wordCount ?? 12
    const profileName = this.options.kdfProfile ?? 'interactive'
    const mnemonic = generateMnemonic(wordCount)
    const createdAt = this.timestamp()

    const document = createEmptyDocument({
      mnemonic,
      wordCount,
      createdAt,
      kdfProfile: profileName,
      autoLockMinutes: this.options.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES,
      addressIndex: this.options.addressIndex ?? 0,
    })

    const sealed = await this.sealDocument({
      document,
      params: KDF_PROFILES[profileName],
      password,
      createdAt,
      updatedAt: createdAt,
    })

    await this.storage.write(sealed.record)
    this.key = sealed.key
    this.document = document

    return { document, mnemonic }
  }

  async unlock(password: string): Promise<VaultDocument> {
    const record = await this.storage.read()

    if (!record) {
      throw new VaultNotFoundError()
    }

    const params = this.usableParams(record)
    const key = await this.deriveKey(password, record, params)
    const document = await this.openDocument(key, record)

    this.key = key
    this.document = document

    return document
  }

  /** Drops the key and the decrypted document. Never touches storage. */
  lock(): void {
    this.key?.fill(0)
    this.key = null
    this.document = null
  }

  /** Re-seals an edited document with the current key. */
  async update(mutator: (document: VaultDocument) => VaultDocument): Promise<VaultDocument> {
    const current = this.getDocument()
    const key = this.key
    const record = await this.storage.read()

    if (!key || !record) {
      throw new VaultLockedError()
    }

    const next = migrateDocument(mutator(current))
    const envelope = await sealJson(key, next, {
      aad: vaultAssociatedData(record.kdf.saltHex),
    })

    await this.storage.write({ ...record, envelope, updatedAt: this.timestamp() })
    this.document = next

    return next
  }

  /**
   * Re-wraps the same document under a new password: a fresh salt, a fresh
   * Argon2id key and a fresh envelope. The mnemonic, contacts and history are
   * unchanged, and the old password stops working immediately.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    assertPasswordStrength(newPassword)

    const record = await this.storage.read()
    if (!record) {
      throw new VaultNotFoundError()
    }

    // Always verify the current password, even while unlocked.
    const params = this.usableParams(record)
    const document = await this.openDocument(
      await this.deriveKey(currentPassword, record, params),
      record,
    )

    const sealed = await this.sealDocument({
      document,
      params,
      password: newPassword,
      createdAt: record.createdAt,
      updatedAt: this.timestamp(),
    })

    await this.storage.write(sealed.record)
    this.key = sealed.key
    this.document = document
  }

  /** Removes the vault from this device. Irreversible without the mnemonic. */
  async destroy(): Promise<void> {
    await this.storage.clear()
    this.lock()
  }

  private async deriveKey(
    password: string,
    record: VaultRecord,
    params: KdfParams,
  ): Promise<Uint8Array> {
    return deriveVaultKey(password, hexToBytes(record.kdf.saltHex), params, {
      allowTestProfile: this.options.allowTestProfile,
    })
  }

  private async openDocument(key: Uint8Array, record: VaultRecord): Promise<VaultDocument> {
    let payload: unknown

    try {
      payload = await openJson<unknown>(key, record.envelope, {
        expectedAad: vaultAssociatedData(record.kdf.saltHex),
      })
    } catch (error) {
      if (error instanceof DecryptionFailedError) {
        throw new WrongPasswordError()
      }
      throw error
    }

    return migrateDocument(payload)
  }

  private async sealDocument(input: {
    document: VaultDocument
    params: KdfParams
    password: string
    createdAt: string
    updatedAt: string
  }): Promise<{ record: VaultRecord; key: Uint8Array }> {
    const salt = randomSalt()
    const saltHex = bytesToHex(salt)
    const key = await deriveVaultKey(input.password, salt, input.params, {
      allowTestProfile: this.options.allowTestProfile,
    })
    const envelope = await sealJson(key, input.document, { aad: vaultAssociatedData(saltHex) })

    return {
      record: {
        id: VAULT_RECORD_ID,
        version: VAULT_RECORD_VERSION,
        kdf: { ...input.params, saltHex },
        envelope,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      },
      key,
    }
  }

  /**
   * A stored record is only openable if its parameters still clear the profile
   * policy. This blocks a tampered record from downgrading Argon2id work.
   */
  private usableParams(record: VaultRecord): KdfParams {
    const params: KdfParams = {
      algorithm: record.kdf.algorithm,
      opsLimit: record.kdf.opsLimit,
      memLimitBytes: record.kdf.memLimitBytes,
    }

    try {
      assertKdfParams(params, { allowTestProfile: this.options.allowTestProfile })
    } catch (error) {
      if (error instanceof InvalidParameterError) {
        throw new UnusableRecordError(
          `vault record uses parameters this build refuses: ${error.message}`,
        )
      }
      throw error
    }

    return params
  }

  private timestamp(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
}
