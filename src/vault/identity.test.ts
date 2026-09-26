import { beforeEach, describe, expect, it } from 'vitest'

import { InvalidKeyMaterialError } from '../crypto/errors'
import { decodeIdentity, deriveMessagingIdentity, deriveWalletAccount } from '../crypto/keys'
import { EVM_TEST_MNEMONIC, FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import { clearIdentityCache, deriveIdentitySummary, identityCacheSize } from './identity'

beforeEach(() => {
  clearIdentityCache()
})

describe('deriveIdentitySummary', () => {
  it('returns the wallet address for the given address index', async () => {
    const summary = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    expect(summary.address).toBe(deriveWalletAccount(FIRST_BIP39_TEST_MNEMONIC, 0).address)
    expect(summary.walletPath).toBe("m/44'/60'/0'/0/0")
  })

  it('honours a non-default address index', async () => {
    const summary = await deriveIdentitySummary(EVM_TEST_MNEMONIC, 2)
    expect(summary.address).toBe(deriveWalletAccount(EVM_TEST_MNEMONIC, 2).address)
    expect(summary.walletPath).toBe("m/44'/60'/0'/0/2")
  })

  it('returns the messaging identity, not the wallet address', async () => {
    const summary = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    expect(summary.messagingPublicKey).toBe(
      deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC).publicKey,
    )
    expect(summary.messagingPath).toBe("m/44'/60'/1'/0/0")
    expect(summary.messagingPublicKey).not.toBe(summary.address)
  })

  it('encodes an identity string that decodes back to the messaging key', async () => {
    const summary = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    expect(summary.identityString.startsWith('oblivion1')).toBe(true)
    expect(await decodeIdentity(summary.identityString)).toBe(summary.messagingPublicKey)
  })

  it('returns a short fingerprint', async () => {
    const summary = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    expect(summary.fingerprint).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/)
  })

  it('caches derivations so the UI does not repeat PBKDF2', async () => {
    const first = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    const second = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)

    expect(second).toBe(first)
    expect(identityCacheSize()).toBe(1)
  })

  it('keys the cache by mnemonic and address index', async () => {
    await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC, 0)
    await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC, 1)
    await deriveIdentitySummary(EVM_TEST_MNEMONIC, 0)

    expect(identityCacheSize()).toBe(3)
  })

  it('normalizes the mnemonic before caching', async () => {
    const first = await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    const second = await deriveIdentitySummary(`  ${FIRST_BIP39_TEST_MNEMONIC.toUpperCase()} `)

    expect(second).toBe(first)
    expect(identityCacheSize()).toBe(1)
  })

  it('clears the cache on request', async () => {
    await deriveIdentitySummary(FIRST_BIP39_TEST_MNEMONIC)
    clearIdentityCache()
    expect(identityCacheSize()).toBe(0)
  })

  it('rejects an invalid mnemonic', async () => {
    await expect(deriveIdentitySummary('not a mnemonic')).rejects.toThrow(InvalidKeyMaterialError)
  })
})
