/**
 * Committed test vectors for the crypto module.
 *
 * Two kinds, and the distinction matters (STANDARDS §1.3):
 *
 * - `published`  — taken from a standard or from publicly documented values
 *                  (BIP-39, BIP-32, the well-known Ethereum test mnemonics).
 *                  If our code disagrees with one of these, our code is wrong.
 * - `regression` — captured from the pinned library build in this repo. They
 *                  pin *behaviour* (parameters, wire format, library version),
 *                  not third-party correctness. Provenance is recorded so the
 *                  number is never presented as something it is not.
 *
 * No vector contains a funded key: every mnemonic here is a public test vector.
 */
import type { KdfProfileName } from './kdf'

export interface VectorProvenance {
  readonly kind: 'published' | 'regression'
  /** Where the value comes from, in words. */
  readonly citation: string
  readonly url?: string
  /** What the vector is pinned for, and any caveat. */
  readonly note?: string
  /** Regression vectors only: the exact library the value was captured with. */
  readonly capturedWith?: string
  readonly capturedOn?: string
}

export const VECTOR_CAPTURE_ENVIRONMENT = {
  capturedWith: 'libsodium-wrappers-sumo@0.8.4 (libsodium 26.4), @scure/bip39@2.4.0, viem@2.56.9',
  capturedOn: '2026-09-25',
  capturedOnRuntime: 'Node 24.20.0 on win32',
} as const

export interface Bip39SeedVector {
  readonly id: string
  readonly mnemonic: string
  readonly passphrase: string
  readonly seedHex: string
  readonly provenance: VectorProvenance
}

export interface Bip32ExtendedKeyVector {
  readonly id: string
  readonly seedHex: string
  readonly path: string
  readonly xpub: string
  readonly xprv: string
  readonly provenance: VectorProvenance
}

export interface Bip44AccountVector {
  readonly id: string
  readonly mnemonic: string
  readonly addressIndex: number
  readonly path: string
  readonly address: string
  /** Present only where the private key is published or independently verified. */
  readonly privateKeyHex?: string
  readonly provenance: VectorProvenance
}

export interface KdfRegressionVector {
  readonly id: string
  readonly password: string
  readonly saltHex: string
  readonly profile: KdfProfileName
  readonly opsLimit: number
  readonly memLimitBytes: number
  readonly keyHex: string
  readonly provenance: VectorProvenance
}

export interface AeadRegressionVector {
  readonly id: string
  readonly keyHex: string
  readonly nonceHex: string
  readonly aadText: string
  readonly plaintextText: string
  readonly ciphertextHex: string
  readonly provenance: VectorProvenance
}

const BIP39_URL = 'https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki'
const BIP32_URL = 'https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki'

/** The BIP-39 test mnemonic used across wallet test suites. */
export const FIRST_BIP39_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/** The mnemonic behind Hardhat/Anvil's first default accounts. */
export const EVM_TEST_MNEMONIC = 'test test test test test test test test test test test junk'

export const BIP39_SEED_VECTORS: readonly Bip39SeedVector[] = [
  {
    id: 'bip39-trezor-1',
    mnemonic: FIRST_BIP39_TEST_MNEMONIC,
    passphrase: 'TREZOR',
    seedHex:
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    provenance: {
      kind: 'published',
      citation: 'BIP-39 specification, "Test vectors", vector 1 (passphrase "TREZOR")',
      url: BIP39_URL,
      note: 'Also re-derived in tests with Node\u2019s own PBKDF2-HMAC-SHA512, an independent implementation.',
    },
  },
  {
    id: 'bip39-empty-passphrase',
    mnemonic: FIRST_BIP39_TEST_MNEMONIC,
    passphrase: '',
    seedHex:
      '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
    provenance: {
      kind: 'published',
      citation: 'Published BIP-39 seed for the "abandon…about" mnemonic with an empty passphrase',
      url: BIP39_URL,
      note: 'Cross-checked in tests against Node\u2019s PBKDF2-HMAC-SHA512.',
    },
  },
]

export const BIP32_EXTENDED_KEY_VECTORS: readonly Bip32ExtendedKeyVector[] = [
  {
    id: 'bip32-vector-1-m',
    seedHex: '000102030405060708090a0b0c0d0e0f',
    path: 'm',
    xpub: 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8',
    xprv: 'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi',
    provenance: {
      kind: 'published',
      citation: 'BIP-32 specification, test vector 1, chain m',
      url: BIP32_URL,
    },
  },
  {
    id: 'bip32-vector-1-m-0h-1',
    seedHex: '000102030405060708090a0b0c0d0e0f',
    path: "m/0'/1",
    xpub: 'xpub6ASuArnXKPbfEwhqN6e3mwBcDTgzisQN1wXN9BJcM47sSikHjJf3UFHKkNAWbWMiGj7Wf5uMash7SyYq527Hqck2AxYysAA7xmALppuCkwQ',
    xprv: 'xprv9wTYmMFdV23N2TdNG573QoEsfRrWKQgWeibmLntzniatZvR9BmLnvSxqu53Kw1UmYPxLgboyZQaXwTCg8MSY3H2EU4pWcQDnRnrVA1xe8fs',
    provenance: {
      kind: 'published',
      citation: "BIP-32 specification, test vector 1, chain m/0'/1",
      url: BIP32_URL,
    },
  },
  {
    id: 'bip32-vector-2-m',
    seedHex:
      'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
    path: 'm',
    xpub: 'xpub661MyMwAqRbcFW31YEwpkMuc5THy2PSt5bDMsktWQcFF8syAmRUapSCGu8ED9W6oDMSgv6Zz8idoc4a6mr8BDzTJY47LJhkJ8UB7WEGuduB',
    xprv: 'xprv9s21ZrQH143K31xYSDQpPDxsXRTUcvj2iNHm5NUtrGiGG5e2DtALGdso3pGz6ssrdK4PFmM8NSpSBHNqPqm55Qn3LqFtT2emdEXVYsCzC2U',
    provenance: {
      kind: 'published',
      citation: 'BIP-32 specification, test vector 2, chain m',
      url: BIP32_URL,
    },
  },
]

export const BIP44_ACCOUNT_VECTORS: readonly Bip44AccountVector[] = [
  {
    id: 'bip44-abandon-account-0',
    mnemonic: FIRST_BIP39_TEST_MNEMONIC,
    addressIndex: 0,
    path: "m/44'/60'/0'/0/0",
    address: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
    privateKeyHex: '0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727',
    provenance: {
      kind: 'published',
      citation:
        "Publicly documented Ethereum derivation for the BIP-39 \"abandon…about\" test mnemonic at m/44'/60'/0'/0/0",
      url: BIP39_URL,
      note: 'The URL is where the mnemonic comes from; the address itself is the widely published Ethereum account for it and is reproduced by viem 2.56.9 `mnemonicToAccount`. The private key is the one that derives that address, so the pair is self-consistent.',
    },
  },
  {
    id: 'bip44-anvil-account-0',
    mnemonic: EVM_TEST_MNEMONIC,
    addressIndex: 0,
    path: "m/44'/60'/0'/0/0",
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    provenance: {
      kind: 'published',
      citation: 'Hardhat / Anvil default account #0 for the standard test mnemonic',
      url: 'https://hardhat.org/hardhat-network/docs/reference',
    },
  },
  {
    id: 'bip44-anvil-account-1',
    mnemonic: EVM_TEST_MNEMONIC,
    addressIndex: 1,
    path: "m/44'/60'/0'/0/1",
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    provenance: {
      kind: 'published',
      citation: 'Hardhat / Anvil default account #1 for the standard test mnemonic',
      url: 'https://hardhat.org/hardhat-network/docs/reference',
    },
  },
  {
    id: 'bip44-anvil-account-2',
    mnemonic: EVM_TEST_MNEMONIC,
    addressIndex: 2,
    path: "m/44'/60'/0'/0/2",
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    provenance: {
      kind: 'published',
      citation: 'Hardhat / Anvil default account #2 for the standard test mnemonic',
      url: 'https://hardhat.org/hardhat-network/docs/reference',
    },
  },
]

export const KDF_REGRESSION_VECTORS: readonly KdfRegressionVector[] = [
  {
    id: 'kdf-test-profile',
    password: 'correct horse battery staple',
    saltHex: '000102030405060708090a0b0c0d0e0f',
    profile: 'test',
    opsLimit: 1,
    memLimitBytes: 8 * 1024 * 1024,
    keyHex: '9aeef75313e585f492c33c5e12d82e9ad253b7dd78632d537e899cd4eddd789c',
    provenance: {
      kind: 'regression',
      citation: 'Captured in this repo from the pinned libsodium build (test profile)',
      note: 'Pins Argon2id parameters and the library version. Not an external standard vector.',
      ...VECTOR_CAPTURE_ENVIRONMENT,
    },
  },
  {
    id: 'kdf-interactive-profile',
    password: 'correct horse battery staple',
    saltHex: '000102030405060708090a0b0c0d0e0f',
    profile: 'interactive',
    opsLimit: 3,
    memLimitBytes: 64 * 1024 * 1024,
    keyHex: '0d1a3c6523c8f06e4e0af9c515aa5b5448cfebd6838f2d52c3d8b6ef8ddc3c2e',
    provenance: {
      kind: 'regression',
      citation: 'Captured in this repo from the pinned libsodium build (interactive profile)',
      note: 'This is the profile the app uses by default, so a change here is a user-visible change.',
      ...VECTOR_CAPTURE_ENVIRONMENT,
    },
  },
]

export const AEAD_REGRESSION_VECTORS: readonly AeadRegressionVector[] = [
  {
    id: 'xchacha20poly1305-fixed-nonce',
    keyHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    nonceHex: '202122232425262728292a2b2c2d2e2f3031323334353637',
    aadText: 'oblivion/test/v1',
    plaintextText: 'oblivion regression vector',
    ciphertextHex:
      '723b21a20d5e7be518cc35da3a2272a2543abf1ca9f665c18e13719acad882e0764904f7b93e19d88027',
    provenance: {
      kind: 'regression',
      citation: 'Captured in this repo from the pinned libsodium build (fixed key, nonce and AAD)',
      note: 'Pins the AEAD construction (XChaCha20-Poly1305, 24-byte nonce, 16-byte tag) and the library version.',
      ...VECTOR_CAPTURE_ENVIRONMENT,
    },
  },
]
