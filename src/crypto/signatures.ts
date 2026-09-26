import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'

import { bytesToHex, hexToBytes, utf8ToBytes } from './encoding'
import { InvalidKeyMaterialError, MalformedPayloadError } from './errors'

export const SIGNATURE_BYTES = 64

/**
 * Signs `payload` with the messaging private key.
 *
 * The digest is SHA-256 and the signature is the 64-byte compact secp256k1
 * form (low-S, deterministic per RFC 6979). Signatures give *authenticity*, not
 * deniability, and not forward secrecy — see docs/SECURITY.md.
 */
export function signBytes(privateKeyHex: string, payload: Uint8Array): string {
  const privateKey = parsePrivateKey(privateKeyHex)
  const signature = secp256k1.sign(sha256(payload), privateKey)
  return bytesToHex(signature, { prefix: true })
}

export function verifyBytes(
  compressedPublicKeyHex: string,
  payload: Uint8Array,
  signatureHex: string,
): boolean {
  const publicKey = parsePublicKey(compressedPublicKeyHex)
  const signature = hexToBytes(signatureHex)

  if (signature.length !== SIGNATURE_BYTES) return false

  try {
    return secp256k1.verify(signature, sha256(payload), publicKey)
  } catch {
    return false
  }
}

export function signText(privateKeyHex: string, text: string): string {
  return signBytes(privateKeyHex, utf8ToBytes(text))
}

export function verifyText(
  compressedPublicKeyHex: string,
  text: string,
  signatureHex: string,
): boolean {
  return verifyBytes(compressedPublicKeyHex, utf8ToBytes(text), signatureHex)
}

function parsePrivateKey(privateKeyHex: string): Uint8Array {
  const privateKey = hexToBytes(privateKeyHex)

  if (privateKey.length !== 32) {
    throw new InvalidKeyMaterialError(`private key must be 32 bytes, received ${privateKey.length}`)
  }

  if (!secp256k1.utils.isValidSecretKey(privateKey)) {
    throw new InvalidKeyMaterialError('private key is not a valid secp256k1 scalar')
  }

  return privateKey
}

function parsePublicKey(compressedPublicKeyHex: string): Uint8Array {
  const publicKey = hexToBytes(compressedPublicKeyHex)

  if (publicKey.length !== 33) {
    throw new MalformedPayloadError(
      `compressed public key must be 33 bytes, received ${publicKey.length}`,
    )
  }

  if (!secp256k1.utils.isValidPublicKey(publicKey)) {
    throw new MalformedPayloadError('public key is not a valid secp256k1 point')
  }

  return publicKey
}
