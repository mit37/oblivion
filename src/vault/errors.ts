export type VaultErrorCode =
  | 'vault-locked'
  | 'vault-not-found'
  | 'vault-exists'
  | 'weak-password'
  | 'wrong-password'
  | 'unusable-record'

export class VaultError extends Error {
  readonly code: VaultErrorCode

  constructor(code: VaultErrorCode, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** An operation needed the unlocked vault key, and there is none. */
export class VaultLockedError extends VaultError {
  constructor(message = 'the vault is locked') {
    super('vault-locked', message)
  }
}

/** No vault has been created on this device yet. */
export class VaultNotFoundError extends VaultError {
  constructor(message = 'no vault exists on this device yet') {
    super('vault-not-found', message)
  }
}

/** A vault already exists; creating another would destroy the first. */
export class VaultExistsError extends VaultError {
  constructor(message = 'a vault already exists on this device') {
    super('vault-exists', message)
  }
}

/** The password does not meet the minimum length. */
export class WeakPasswordError extends VaultError {
  constructor(message: string) {
    super('weak-password', message)
  }
}

/**
 * The vault key did not open the record. One error for a wrong password and for
 * damaged records, because an attacker should not learn which one they have.
 */
export class WrongPasswordError extends VaultError {
  constructor(message = 'wrong password, or the vault record is damaged') {
    super('wrong-password', message)
  }
}

/**
 * The stored record asks for KDF parameters this build refuses to unlock with
 * (weaker than the interactive profile). Refusing is safer than honouring it.
 */
export class UnusableRecordError extends VaultError {
  constructor(message: string) {
    super('unusable-record', message)
  }
}
