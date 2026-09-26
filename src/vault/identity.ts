import {
  assertValidMnemonic,
  deriveMessagingIdentity,
  deriveWalletAccount,
  encodeIdentity,
  publicKeyFingerprint,
  type HexString,
} from '../crypto/keys'

export interface VaultIdentitySummary {
  /** Sepolia account address. */
  readonly address: HexString
  readonly walletPath: string
  /** SEC1-compressed messaging public key. */
  readonly messagingPublicKey: HexString
  readonly messagingPath: string
  /** `oblivion1…` string a contact can be added by. */
  readonly identityString: string
  readonly fingerprint: string
}

const cache = new Map<string, VaultIdentitySummary>()

/**
 * Derives the wallet address and the messaging identity from the vault's
 * mnemonic. BIP-39's PBKDF2 is deliberately slow, so results are cached per
 * (mnemonic, address index); the cache is cleared when the vault locks.
 */
export async function deriveIdentitySummary(
  mnemonic: string,
  addressIndex = 0,
): Promise<VaultIdentitySummary> {
  const normalized = assertValidMnemonic(mnemonic)
  const cacheKey = `${normalized}:${addressIndex}`
  const cached = cache.get(cacheKey)

  if (cached) return cached

  const wallet = deriveWalletAccount(normalized, addressIndex)
  const messaging = deriveMessagingIdentity(normalized)

  const summary: VaultIdentitySummary = {
    address: wallet.address,
    walletPath: wallet.path,
    messagingPublicKey: messaging.publicKey,
    messagingPath: messaging.path,
    identityString: await encodeIdentity(messaging.publicKey),
    fingerprint: publicKeyFingerprint(messaging.publicKey),
  }

  cache.set(cacheKey, summary)
  return summary
}

/** Drops derived key material from memory; called on lock. */
export function clearIdentityCache(): void {
  cache.clear()
}

/** Size of the cache, for tests and diagnostics. */
export function identityCacheSize(): number {
  return cache.size
}
