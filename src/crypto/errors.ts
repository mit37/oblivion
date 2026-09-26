/**
 * Typed errors for the crypto module.
 *
 * Callers (vault, wallet, messaging) branch on `code` rather than on message
 * text, and no error ever includes key material or a library message that could
 * leak whether a decryption failed because of a wrong key or a tampered byte.
 */
export type CryptoErrorCode =
  'invalid-parameter' | 'invalid-key-material' | 'decryption-failed' | 'malformed-payload'

export class CryptoError extends Error {
  readonly code: CryptoErrorCode

  constructor(code: CryptoErrorCode, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** A size, range or profiled parameter outside what the primitives accept. */
export class InvalidParameterError extends CryptoError {
  constructor(message: string) {
    super('invalid-parameter', message)
  }
}

/** Passwords, mnemonics, keys or public keys that are structurally invalid. */
export class InvalidKeyMaterialError extends CryptoError {
  constructor(message: string) {
    super('invalid-key-material', message)
  }
}

/**
 * AEAD open failed: tampered ciphertext, wrong key, or mismatched associated
 * data. Deliberately one error for all three, matching libsodium's behaviour.
 */
export class DecryptionFailedError extends CryptoError {
  constructor(
    message = 'decryption failed: the key, the ciphertext or its context does not match',
  ) {
    super('decryption-failed', message)
  }
}

/** A serialized envelope that is not in the expected wire format. */
export class MalformedPayloadError extends CryptoError {
  constructor(message: string) {
    super('malformed-payload', message)
  }
}
