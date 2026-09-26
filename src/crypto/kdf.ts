import { isUint8Array } from './encoding'
import { InvalidKeyMaterialError, InvalidParameterError } from './errors'
import { randomBytes } from './random'
import { getSodium } from './sodium'

/** libsodium's `crypto_pwhash_SALTBYTES`. */
export const KDF_SALT_BYTES = 16
/** The vault key is a 32-byte XChaCha20-Poly1305 key. */
export const VAULT_KEY_BYTES = 32

export const ARGON2ID_ALGORITHM = 'argon2id'

/** libsodium rejects anything below this; keep the floor explicit. */
export const MIN_MEM_LIMIT_BYTES = 8 * 1024
/** Refuse absurd memory settings up front rather than letting them allocate. */
export const MAX_MEM_LIMIT_BYTES = 1024 * 1024 * 1024

export interface KdfParams {
  readonly algorithm: typeof ARGON2ID_ALGORITHM
  readonly opsLimit: number
  readonly memLimitBytes: number
}

/**
 * Documented Argon2id profiles (standards: ops limit = passes, mem limit = MiB).
 *
 * - `interactive` — the default for unlocking a vault on a laptop or phone:
 *   64 MiB and 3 passes (libsodium's "moderate" guidance for interactive use).
 * - `sensitive` — opt-in in Settings; 256 MiB and 4 passes, ~4x the work.
 * - `test` — deliberately weak and *only* usable from tests/CI so the suite
 *   stays fast. `assertKdfParams` allows it only when `allowTestProfile` is
 *   set, and the vault never passes that flag.
 */
export const KDF_PROFILES = {
  test: { algorithm: ARGON2ID_ALGORITHM, opsLimit: 1, memLimitBytes: 8 * 1024 * 1024 },
  interactive: { algorithm: ARGON2ID_ALGORITHM, opsLimit: 3, memLimitBytes: 64 * 1024 * 1024 },
  sensitive: { algorithm: ARGON2ID_ALGORITHM, opsLimit: 4, memLimitBytes: 256 * 1024 * 1024 },
} as const satisfies Record<string, KdfParams>

export type KdfProfileName = keyof typeof KDF_PROFILES

/** Human-readable summary used by the UI and docs (kept in one place). */
export function describeKdfProfile(name: KdfProfileName): string {
  const params = KDF_PROFILES[name]
  const mebibytes = params.memLimitBytes / (1024 * 1024)
  return `Argon2id, ${params.opsLimit} pass${params.opsLimit === 1 ? '' : 'es'}, ${mebibytes} MiB memory`
}

/** A fresh 16-byte Argon2id salt from WebCrypto. */
export function randomSalt(): Uint8Array {
  return randomBytes(KDF_SALT_BYTES)
}

export interface DeriveVaultKeyOptions {
  /**
   * Tests only: permits the weak `test` profile. The vault and the UI never set
   * this, so production code cannot accidentally pick a fast profile.
   */
  readonly allowTestProfile?: boolean
}

/**
 * Derives the 32-byte vault key from a password and salt with Argon2id.
 *
 * @throws InvalidKeyMaterialError when the password is empty.
 * @throws InvalidParameterError when the salt or the parameters are unusable.
 */
export async function deriveVaultKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams = KDF_PROFILES.interactive,
  options: DeriveVaultKeyOptions = {},
): Promise<Uint8Array> {
  assertPassword(password)
  assertSalt(salt)
  assertKdfParams(params, options)

  const sodium = await getSodium()

  return sodium.crypto_pwhash(
    VAULT_KEY_BYTES,
    password,
    salt,
    params.opsLimit,
    params.memLimitBytes,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )
}

export function assertPassword(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new InvalidKeyMaterialError('password must be a non-empty string')
  }
}

export function assertSalt(salt: Uint8Array): void {
  if (!isUint8Array(salt)) {
    throw new InvalidParameterError('salt must be a Uint8Array')
  }
  if (salt.length !== KDF_SALT_BYTES) {
    throw new InvalidParameterError(`salt must be ${KDF_SALT_BYTES} bytes, received ${salt.length}`)
  }
}

export function assertKdfParams(params: KdfParams, options: DeriveVaultKeyOptions = {}): void {
  if (params.algorithm !== ARGON2ID_ALGORITHM) {
    throw new InvalidParameterError(`unsupported KDF algorithm "${String(params.algorithm)}"`)
  }

  if (!Number.isInteger(params.opsLimit) || params.opsLimit < 1) {
    throw new InvalidParameterError(`opsLimit must be an integer >= 1, received ${params.opsLimit}`)
  }

  if (!Number.isInteger(params.memLimitBytes) || params.memLimitBytes < MIN_MEM_LIMIT_BYTES) {
    throw new InvalidParameterError(
      `memLimitBytes must be an integer >= ${MIN_MEM_LIMIT_BYTES}, received ${params.memLimitBytes}`,
    )
  }

  if (params.memLimitBytes > MAX_MEM_LIMIT_BYTES) {
    throw new InvalidParameterError(
      `memLimitBytes must be <= ${MAX_MEM_LIMIT_BYTES}, received ${params.memLimitBytes}`,
    )
  }

  if (!options.allowTestProfile && params.memLimitBytes < KDF_PROFILES.interactive.memLimitBytes) {
    throw new InvalidParameterError(
      `memLimitBytes is below the interactive profile (${KDF_PROFILES.interactive.memLimitBytes}); only tests may request weaker parameters`,
    )
  }

  if (!options.allowTestProfile && params.opsLimit < KDF_PROFILES.interactive.opsLimit) {
    throw new InvalidParameterError(
      `opsLimit is below the interactive profile (${KDF_PROFILES.interactive.opsLimit}); only tests may request weaker parameters`,
    )
  }
}
