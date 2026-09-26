import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { HDKey } from '@scure/bip32'
import {
  generateMnemonic as generateBip39Mnemonic,
  mnemonicToSeedSync,
  validateMnemonic as validateBip39Mnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { privateKeyToAccount } from 'viem/accounts'

import { base64UrlToBytes, bytesToBase64Url, bytesToHex, hexToBytes } from './encoding'
import { InvalidKeyMaterialError } from './errors'

/** Standard Ethereum account path (BIP-44, coin type 60). */
export const WALLET_ACCOUNT_PATH_PREFIX = "m/44'/60'/0'/0"

/**
 * The messaging identity deliberately sits on a *different* BIP-44 branch
 * (account 1 rather than account 0) of the same seed, so the chat public key is
 * not the wallet address and revealing one does not identify the other.
 */
export const MESSAGING_DERIVATION_PATH = "m/44'/60'/1'/0/0"

/** Human-shareable identity string: this prefix plus unpadded URL-safe base64. */
export const IDENTITY_PREFIX = 'oblivion1'

export const COMPRESSED_PUBLIC_KEY_BYTES = 33
export const SECRET_KEY_BYTES = 32
export const MNEMONIC_WORD_COUNTS = [12, 24] as const

export type MnemonicWordCount = (typeof MNEMONIC_WORD_COUNTS)[number]

export type HexString = `0x${string}`

export interface WalletAccount {
  readonly address: HexString
  readonly privateKey: HexString
  /** Uncompressed SEC1 public key (65 bytes, `0x`-prefixed). */
  readonly publicKey: HexString
  readonly path: string
}

export interface MessagingIdentity {
  readonly privateKey: HexString
  /** Compressed SEC1 public key (33 bytes, `0x`-prefixed). */
  readonly publicKey: HexString
  readonly path: string
}

/** Generates a fresh BIP-39 English mnemonic (12 words = 128 bits by default). */
export function generateMnemonic(wordCount: MnemonicWordCount = 12): string {
  const strength = wordCount === 24 ? 256 : 128
  return generateBip39Mnemonic(wordlist, strength)
}

/** Lower-cases, trims and collapses whitespace so pasted mnemonics work. */
export function normalizeMnemonic(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .join(' ')
}

export function isValidMnemonic(input: string): boolean {
  const normalized = normalizeMnemonic(input)
  if (normalized.length === 0) return false

  const words = normalized.split(' ')
  if (!MNEMONIC_WORD_COUNTS.includes(words.length as MnemonicWordCount)) return false

  return validateBip39Mnemonic(normalized, wordlist)
}

/** Returns the normalized mnemonic or throws `InvalidKeyMaterialError`. */
export function assertValidMnemonic(input: string): string {
  const normalized = normalizeMnemonic(input)

  if (!isValidMnemonic(normalized)) {
    throw new InvalidKeyMaterialError(
      'not a valid BIP-39 English mnemonic: check the word count, spelling and checksum',
    )
  }

  return normalized
}

/** BIP-39 seed (PBKDF2-HMAC-SHA512, 2048 rounds, 64 bytes). */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSync(assertValidMnemonic(mnemonic), passphrase)
}

export function walletAccountPath(addressIndex: number): string {
  if (!Number.isInteger(addressIndex) || addressIndex < 0 || addressIndex > 2 ** 31 - 1) {
    throw new InvalidKeyMaterialError(
      `address index must be an integer between 0 and ${2 ** 31 - 1}, received ${addressIndex}`,
    )
  }
  return `${WALLET_ACCOUNT_PATH_PREFIX}/${addressIndex}`
}

/** Derives the Sepolia (Ethereum) account at `m/44'/60'/0'/0/<addressIndex>`. */
export function deriveWalletAccount(mnemonic: string, addressIndex = 0): WalletAccount {
  const path = walletAccountPath(addressIndex)
  const privateKey = derivePrivateKey(mnemonic, path)
  const privateKeyHex = toHex(privateKey)
  const account = privateKeyToAccount(privateKeyHex)

  return {
    address: account.address,
    privateKey: privateKeyHex,
    publicKey: account.publicKey,
    path,
  }
}

/** Derives the messaging keypair. The chat identity is not the wallet address. */
export function deriveMessagingIdentity(mnemonic: string): MessagingIdentity {
  const privateKey = derivePrivateKey(mnemonic, MESSAGING_DERIVATION_PATH)

  return {
    privateKey: toHex(privateKey),
    publicKey: toHex(secp256k1.getPublicKey(privateKey, true)),
    path: MESSAGING_DERIVATION_PATH,
  }
}

/** `oblivion1<base64url(compressed public key)>` — what a contact QR encodes. */
export async function encodeIdentity(compressedPublicKeyHex: string): Promise<string> {
  const publicKey = parseCompressedPublicKey(compressedPublicKeyHex)
  return `${IDENTITY_PREFIX}${await bytesToBase64Url(publicKey)}`
}

export async function decodeIdentity(identity: string): Promise<HexString> {
  if (typeof identity !== 'string') {
    throw new InvalidKeyMaterialError('identity must be a string')
  }

  const trimmed = identity.trim()
  if (!trimmed.startsWith(IDENTITY_PREFIX)) {
    throw new InvalidKeyMaterialError(`identity must start with "${IDENTITY_PREFIX}"`)
  }

  const payload = await base64UrlToBytes(trimmed.slice(IDENTITY_PREFIX.length))

  if (payload.length !== COMPRESSED_PUBLIC_KEY_BYTES) {
    throw new InvalidKeyMaterialError(
      `identity payload must be ${COMPRESSED_PUBLIC_KEY_BYTES} bytes, received ${payload.length}`,
    )
  }

  const publicKey = bytesToHex(payload, { prefix: true }) as HexString
  parseCompressedPublicKey(publicKey)
  return publicKey
}

/** Validates a SEC1-compressed secp256k1 public key and returns its bytes. */
export function parseCompressedPublicKey(value: string): Uint8Array {
  const bytes = hexToBytes(value)

  if (bytes.length !== COMPRESSED_PUBLIC_KEY_BYTES) {
    throw new InvalidKeyMaterialError(
      `compressed public key must be ${COMPRESSED_PUBLIC_KEY_BYTES} bytes, received ${bytes.length}`,
    )
  }

  const prefix = bytes[0]
  if (prefix !== 0x02 && prefix !== 0x03) {
    throw new InvalidKeyMaterialError('public key must be SEC1-compressed (0x02 or 0x03 prefix)')
  }

  if (!secp256k1.utils.isValidPublicKey(bytes)) {
    throw new InvalidKeyMaterialError('public key is not a valid secp256k1 point')
  }

  return bytes
}

/** Short, stable display form of a public key: `ab12-cd34`. */
export function publicKeyFingerprint(compressedPublicKeyHex: string, half = 4): string {
  const digest = bytesToHex(sha256(parseCompressedPublicKey(compressedPublicKeyHex)))
  const size = Math.max(1, Math.min(half, 16))
  const slice = digest.slice(0, size * 2)
  return `${slice.slice(0, size)}-${slice.slice(size)}`
}

function derivePrivateKey(mnemonic: string, path: string): Uint8Array {
  const node = HDKey.fromMasterSeed(mnemonicToSeed(mnemonic)).derive(path)
  const privateKey = node.privateKey

  if (!privateKey) {
    throw new InvalidKeyMaterialError(`derivation at ${path} produced no private key`)
  }

  if (privateKey.length !== SECRET_KEY_BYTES) {
    throw new InvalidKeyMaterialError(
      `derived private key must be ${SECRET_KEY_BYTES} bytes, received ${privateKey.length}`,
    )
  }

  return privateKey
}

function toHex(bytes: Uint8Array): HexString {
  return bytesToHex(bytes, { prefix: true }) as HexString
}
