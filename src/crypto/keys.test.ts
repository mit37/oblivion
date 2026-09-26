import { pbkdf2Sync } from 'node:crypto'

import { HDKey } from '@scure/bip32'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, it } from 'vitest'

import { bytesToBase64Url, bytesToHex, hexToBytes } from './encoding'
import { InvalidKeyMaterialError } from './errors'
import {
  IDENTITY_PREFIX,
  MESSAGING_DERIVATION_PATH,
  WALLET_ACCOUNT_PATH_PREFIX,
  assertValidMnemonic,
  decodeIdentity,
  deriveMessagingIdentity,
  deriveWalletAccount,
  encodeIdentity,
  generateMnemonic,
  isValidMnemonic,
  mnemonicToSeed,
  normalizeMnemonic,
  publicKeyFingerprint,
  walletAccountPath,
} from './keys'
import {
  BIP32_EXTENDED_KEY_VECTORS,
  BIP39_SEED_VECTORS,
  BIP44_ACCOUNT_VECTORS,
  EVM_TEST_MNEMONIC,
  FIRST_BIP39_TEST_MNEMONIC,
} from './vectors'

const PUBLISHED_MNEMONIC_VECTOR = BIP39_SEED_VECTORS[0]
const ABANDON_ACCOUNT_VECTOR = BIP44_ACCOUNT_VECTORS[0]

describe('generateMnemonic', () => {
  it('returns 12 words by default', () => {
    expect(generateMnemonic().split(' ')).toHaveLength(12)
  })

  it('returns 24 words when asked', () => {
    expect(generateMnemonic(24).split(' ')).toHaveLength(24)
  })

  it('returns a valid mnemonic every time', () => {
    for (let index = 0; index < 5; index += 1) {
      expect(isValidMnemonic(generateMnemonic())).toBe(true)
      expect(isValidMnemonic(generateMnemonic(24))).toBe(true)
    }
  })

  it('returns a different mnemonic on each call', () => {
    const seen = new Set(Array.from({ length: 10 }, () => generateMnemonic()))
    expect(seen.size).toBe(10)
  })
})

describe('mnemonic validation', () => {
  it('accepts the published test mnemonic', () => {
    expect(isValidMnemonic(FIRST_BIP39_TEST_MNEMONIC)).toBe(true)
    expect(isValidMnemonic(EVM_TEST_MNEMONIC)).toBe(true)
  })

  it('normalizes case, padding and extra whitespace', () => {
    const messy = `  ${FIRST_BIP39_TEST_MNEMONIC.toUpperCase().split(' ').join('   ')}  `
    expect(normalizeMnemonic(messy)).toBe(FIRST_BIP39_TEST_MNEMONIC)
    expect(isValidMnemonic(messy)).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidMnemonic('   ')).toBe(false)
    expect(isValidMnemonic('')).toBe(false)
  })

  it('rejects 11 words', () => {
    expect(isValidMnemonic(FIRST_BIP39_TEST_MNEMONIC.split(' ').slice(0, 11).join(' '))).toBe(false)
  })

  it('rejects 13 words', () => {
    expect(isValidMnemonic(`${FIRST_BIP39_TEST_MNEMONIC} abandon`)).toBe(false)
  })

  it('rejects a word outside the BIP-39 English list', () => {
    const words = FIRST_BIP39_TEST_MNEMONIC.split(' ')
    words[5] = 'oblivion'
    expect(isValidMnemonic(words.join(' '))).toBe(false)
  })

  it('rejects a bad checksum', () => {
    const words = FIRST_BIP39_TEST_MNEMONIC.split(' ')
    words[11] = 'abandon'
    expect(isValidMnemonic(words.join(' '))).toBe(false)
  })

  it('throws a typed error from assertValidMnemonic', () => {
    expect(() => assertValidMnemonic('nope')).toThrow(InvalidKeyMaterialError)
    expect(assertValidMnemonic(FIRST_BIP39_TEST_MNEMONIC)).toBe(FIRST_BIP39_TEST_MNEMONIC)
  })
})

describe('mnemonicToSeed (BIP-39)', () => {
  it('matches the published BIP-39 vector with a passphrase', () => {
    expect(bytesToHex(mnemonicToSeed(PUBLISHED_MNEMONIC_VECTOR.mnemonic, 'TREZOR'))).toBe(
      PUBLISHED_MNEMONIC_VECTOR.seedHex,
    )
  })

  it('matches the published BIP-39 vector with an empty passphrase', () => {
    const vector = BIP39_SEED_VECTORS[1]
    expect(bytesToHex(mnemonicToSeed(vector.mnemonic, vector.passphrase))).toBe(vector.seedHex)
  })

  it('agrees with Node\u2019s own PBKDF2-HMAC-SHA512 (independent implementation)', () => {
    const independent = pbkdf2Sync(
      Buffer.from(PUBLISHED_MNEMONIC_VECTOR.mnemonic.normalize('NFKD'), 'utf8'),
      Buffer.from(`mnemonic${PUBLISHED_MNEMONIC_VECTOR.passphrase}`.normalize('NFKD'), 'utf8'),
      2048,
      64,
      'sha512',
    )

    expect(bytesToHex(independent)).toBe(PUBLISHED_MNEMONIC_VECTOR.seedHex)
    expect(
      bytesToHex(
        mnemonicToSeed(PUBLISHED_MNEMONIC_VECTOR.mnemonic, PUBLISHED_MNEMONIC_VECTOR.passphrase),
      ),
    ).toBe(PUBLISHED_MNEMONIC_VECTOR.seedHex)
  })

  it('returns 64 bytes', () => {
    expect(mnemonicToSeed(FIRST_BIP39_TEST_MNEMONIC)).toHaveLength(64)
  })

  it('changes when the passphrase changes', () => {
    expect(bytesToHex(mnemonicToSeed(FIRST_BIP39_TEST_MNEMONIC, 'a'))).not.toBe(
      bytesToHex(mnemonicToSeed(FIRST_BIP39_TEST_MNEMONIC, 'b')),
    )
  })

  it('refuses an invalid mnemonic', () => {
    expect(() => mnemonicToSeed('not a real mnemonic')).toThrow(InvalidKeyMaterialError)
  })
})

describe('BIP-32 derivation against the specification', () => {
  for (const vector of BIP32_EXTENDED_KEY_VECTORS) {
    it(`reproduces the published extended keys for ${vector.path} (${vector.id})`, () => {
      const master = HDKey.fromMasterSeed(hexToBytes(vector.seedHex))
      const derived = vector.path === 'm' ? master : master.derive(vector.path)

      expect(derived.privateExtendedKey).toBe(vector.xprv)
      expect(derived.publicExtendedKey).toBe(vector.xpub)
    })
  }
})

describe('wallet account paths', () => {
  it('uses the standard Ethereum BIP-44 path', () => {
    expect(WALLET_ACCOUNT_PATH_PREFIX).toBe("m/44'/60'/0'/0")
    expect(walletAccountPath(0)).toBe("m/44'/60'/0'/0/0")
  })

  it('appends the address index', () => {
    expect(walletAccountPath(7)).toBe("m/44'/60'/0'/0/7")
  })

  it('rejects a negative index', () => {
    expect(() => walletAccountPath(-1)).toThrow(InvalidKeyMaterialError)
  })

  it('rejects a non-integer index', () => {
    expect(() => walletAccountPath(1.5)).toThrow(InvalidKeyMaterialError)
  })

  it('rejects an index beyond the non-hardened range', () => {
    expect(() => walletAccountPath(2 ** 31)).toThrow(InvalidKeyMaterialError)
  })

  it('puts the messaging identity on a different branch than the wallet', () => {
    expect(MESSAGING_DERIVATION_PATH).not.toBe(walletAccountPath(0))
    expect(MESSAGING_DERIVATION_PATH).toBe("m/44'/60'/1'/0/0")
  })
})

describe('deriveWalletAccount', () => {
  it('reproduces the published abandon-mnemonic account', () => {
    const account = deriveWalletAccount(ABANDON_ACCOUNT_VECTOR.mnemonic, 0)
    expect(account.path).toBe(ABANDON_ACCOUNT_VECTOR.path)
    expect(account.address).toBe(ABANDON_ACCOUNT_VECTOR.address)
    expect(account.privateKey).toBe(ABANDON_ACCOUNT_VECTOR.privateKeyHex)
  })

  it('reproduces the published Hardhat/Anvil accounts', () => {
    for (const vector of BIP44_ACCOUNT_VECTORS.slice(1)) {
      const account = deriveWalletAccount(vector.mnemonic, vector.addressIndex)
      expect(account.address).toBe(vector.address)
      expect(account.path).toBe(vector.path)
    }
  })

  it('returns a 32-byte private key and a 65-byte public key', () => {
    const account = deriveWalletAccount(FIRST_BIP39_TEST_MNEMONIC)
    expect(hexToBytes(account.privateKey)).toHaveLength(32)
    expect(hexToBytes(account.publicKey)).toHaveLength(65)
  })

  it('derives different accounts for different indices', () => {
    const first = deriveWalletAccount(EVM_TEST_MNEMONIC, 0)
    const second = deriveWalletAccount(EVM_TEST_MNEMONIC, 1)
    expect(first.address).not.toBe(second.address)
    expect(first.privateKey).not.toBe(second.privateKey)
  })

  it('matches viem\u2019s own account derivation for the same private key', () => {
    const account = deriveWalletAccount(FIRST_BIP39_TEST_MNEMONIC)
    expect(privateKeyToAccount(account.privateKey).address).toBe(account.address)
  })

  it('throws for an invalid mnemonic', () => {
    expect(() => deriveWalletAccount('abandon abandon abandon')).toThrow(InvalidKeyMaterialError)
  })
})

describe('deriveMessagingIdentity', () => {
  it('returns a 33-byte SEC1-compressed public key', () => {
    const identity = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
    const publicKey = hexToBytes(identity.publicKey)
    expect(publicKey).toHaveLength(33)
    expect([0x02, 0x03]).toContain(publicKey[0])
  })

  it('returns a 32-byte private key at the messaging path', () => {
    const identity = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
    expect(hexToBytes(identity.privateKey)).toHaveLength(32)
    expect(identity.path).toBe(MESSAGING_DERIVATION_PATH)
  })

  it('does not reuse the wallet address or key', () => {
    const wallet = deriveWalletAccount(FIRST_BIP39_TEST_MNEMONIC)
    const identity = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)

    expect(privateKeyToAccount(identity.privateKey).address).not.toBe(wallet.address)
    expect(identity.privateKey).not.toBe(wallet.privateKey)
  })

  it('is deterministic for the same mnemonic', () => {
    const first = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
    const second = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
    expect(first.publicKey).toBe(second.publicKey)
  })

  it('differs between mnemonics', () => {
    expect(deriveMessagingIdentity(EVM_TEST_MNEMONIC).publicKey).not.toBe(
      deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC).publicKey,
    )
  })

  it('throws for an invalid mnemonic', () => {
    expect(() => deriveMessagingIdentity('test test test')).toThrow(InvalidKeyMaterialError)
  })
})

describe('identity encoding', () => {
  it('round-trips a messaging identity', async () => {
    const identity = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
    const encoded = await encodeIdentity(identity.publicKey)

    expect(encoded.startsWith(IDENTITY_PREFIX)).toBe(true)
    expect(await decodeIdentity(encoded)).toBe(identity.publicKey)
  })

  it('is stable across encode/decode cycles', async () => {
    const identity = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
    const once = await encodeIdentity(identity.publicKey)
    const twice = await encodeIdentity(await decodeIdentity(once))
    expect(twice).toBe(once)
  })

  it('tolerates surrounding whitespace', async () => {
    const identity = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
    const encoded = await encodeIdentity(identity.publicKey)
    expect(await decodeIdentity(`  ${encoded}\n`)).toBe(identity.publicKey)
  })

  it('rejects a wrong prefix', async () => {
    const identity = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
    const encoded = await encodeIdentity(identity.publicKey)
    await expect(decodeIdentity(encoded.replace(IDENTITY_PREFIX, 'oblivion2'))).rejects.toThrow(
      InvalidKeyMaterialError,
    )
  })

  it('rejects a payload of the wrong length', async () => {
    const short = await bytesToBase64Url(new Uint8Array(10))
    await expect(decodeIdentity(`${IDENTITY_PREFIX}${short}`)).rejects.toThrow(
      InvalidKeyMaterialError,
    )
  })

  it('rejects a payload that is not a valid curve point', async () => {
    const invalidPoint = Uint8Array.from([0x02, ...new Array(32).fill(0xff)])
    const encoded = `${IDENTITY_PREFIX}${await bytesToBase64Url(invalidPoint)}`
    await expect(decodeIdentity(encoded)).rejects.toThrow(InvalidKeyMaterialError)
  })

  it('rejects a non-string identity', async () => {
    await expect(decodeIdentity(42 as unknown as string)).rejects.toThrow(InvalidKeyMaterialError)
  })

  it('refuses to encode an uncompressed public key', async () => {
    const account = deriveWalletAccount(FIRST_BIP39_TEST_MNEMONIC)
    await expect(encodeIdentity(account.publicKey)).rejects.toThrow(InvalidKeyMaterialError)
  })
})

describe('publicKeyFingerprint', () => {
  it('is short and stable', () => {
    const identity = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
    const fingerprint = publicKeyFingerprint(identity.publicKey)

    expect(fingerprint).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/)
    expect(publicKeyFingerprint(identity.publicKey)).toBe(fingerprint)
  })

  it('differs between identities', () => {
    expect(publicKeyFingerprint(deriveMessagingIdentity(EVM_TEST_MNEMONIC).publicKey)).not.toBe(
      publicKeyFingerprint(deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC).publicKey),
    )
  })
})
