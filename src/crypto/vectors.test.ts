import { describe, expect, it } from 'vitest'

import { bytesToHex, hexToBytes, utf8ToBytes } from './encoding'
import { AEAD_KEY_BYTES, AEAD_NONCE_BYTES, AEAD_TAG_BYTES } from './aead'
import { KDF_PROFILES, KDF_SALT_BYTES, VAULT_KEY_BYTES } from './kdf'
import { isValidMnemonic, walletAccountPath } from './keys'
import {
  AEAD_REGRESSION_VECTORS,
  BIP32_EXTENDED_KEY_VECTORS,
  BIP39_SEED_VECTORS,
  BIP44_ACCOUNT_VECTORS,
  KDF_REGRESSION_VECTORS,
  VECTOR_CAPTURE_ENVIRONMENT,
} from './vectors'

const ALL_VECTORS = [
  ...BIP39_SEED_VECTORS,
  ...BIP32_EXTENDED_KEY_VECTORS,
  ...BIP44_ACCOUNT_VECTORS,
  ...KDF_REGRESSION_VECTORS,
  ...AEAD_REGRESSION_VECTORS,
]

describe('vector provenance', () => {
  it('records a citation for every vector', () => {
    for (const vector of ALL_VECTORS) {
      expect(vector.provenance.citation.length).toBeGreaterThan(10)
    }
  })

  it('gives every published vector a source URL', () => {
    for (const vector of ALL_VECTORS.filter((entry) => entry.provenance.kind === 'published')) {
      expect(typeof vector.provenance.url).toBe('string')
      expect(vector.provenance.url).toMatch(/^https:\/\//)
    }
  })

  it('records the capturing library and date for every regression vector', () => {
    for (const vector of ALL_VECTORS.filter((entry) => entry.provenance.kind === 'regression')) {
      expect(vector.provenance.capturedWith).toBeTruthy()
      expect(vector.provenance.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(vector.provenance.url).toBeUndefined()
    }
  })

  it('never claims a regression value is a published one', () => {
    for (const vector of ALL_VECTORS) {
      if (vector.provenance.kind === 'regression') {
        expect(vector.provenance.citation).toMatch(/captured/i)
      } else {
        expect(vector.provenance.citation).not.toMatch(/captured/i)
      }
    }
  })

  it('documents the capture environment', () => {
    expect(VECTOR_CAPTURE_ENVIRONMENT.capturedWith).toContain('libsodium-wrappers-sumo')
    expect(VECTOR_CAPTURE_ENVIRONMENT.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses unique vector ids', () => {
    const ids = ALL_VECTORS.map((vector) => vector.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('BIP-39 vectors', () => {
  it('carries a valid mnemonic and a 64-byte seed for each entry', () => {
    for (const vector of BIP39_SEED_VECTORS) {
      expect(isValidMnemonic(vector.mnemonic)).toBe(true)
      expect(hexToBytes(vector.seedHex)).toHaveLength(64)
    }
  })

  it('uses only the well-known public test mnemonics', () => {
    const known = new Set(['abandon', 'about', 'test', 'junk'])
    for (const vector of BIP39_SEED_VECTORS) {
      for (const word of vector.mnemonic.split(' ')) {
        expect(known.has(word)).toBe(true)
      }
    }
  })
})

describe('BIP-32 vectors', () => {
  it('carries a hexadecimal seed and correctly prefixed extended keys', () => {
    for (const vector of BIP32_EXTENDED_KEY_VECTORS) {
      expect(bytesToHex(hexToBytes(vector.seedHex))).toBe(vector.seedHex.toLowerCase())
      expect(vector.xprv.startsWith('xprv')).toBe(true)
      expect(vector.xpub.startsWith('xpub')).toBe(true)
      expect(vector.xprv).toHaveLength(111)
      expect(vector.xpub).toHaveLength(111)
    }
  })
})

describe('BIP-44 account vectors', () => {
  it('uses the standard Ethereum path for each address index', () => {
    for (const vector of BIP44_ACCOUNT_VECTORS) {
      expect(vector.path).toBe(walletAccountPath(vector.addressIndex))
    }
  })

  it('carries a checksummed-looking 20-byte address', () => {
    for (const vector of BIP44_ACCOUNT_VECTORS) {
      expect(vector.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('only pins a private key where it is safe to publish one', () => {
    for (const vector of BIP44_ACCOUNT_VECTORS) {
      if (vector.privateKeyHex) {
        expect(hexToBytes(vector.privateKeyHex)).toHaveLength(32)
        expect(vector.provenance.kind).toBe('published')
      }
    }
  })
})

describe('KDF regression vectors', () => {
  it('matches the profile it claims to use', () => {
    for (const vector of KDF_REGRESSION_VECTORS) {
      const profile = KDF_PROFILES[vector.profile]
      expect(vector.opsLimit).toBe(profile.opsLimit)
      expect(vector.memLimitBytes).toBe(profile.memLimitBytes)
    }
  })

  it('carries a 16-byte salt and a 32-byte key', () => {
    for (const vector of KDF_REGRESSION_VECTORS) {
      expect(hexToBytes(vector.saltHex)).toHaveLength(KDF_SALT_BYTES)
      expect(hexToBytes(vector.keyHex)).toHaveLength(VAULT_KEY_BYTES)
    }
  })

  it('does not publish a real password', () => {
    for (const vector of KDF_REGRESSION_VECTORS) {
      expect(vector.password).toBe('correct horse battery staple')
    }
  })
})

describe('AEAD regression vectors', () => {
  it('uses a 32-byte key and a 24-byte nonce', () => {
    for (const vector of AEAD_REGRESSION_VECTORS) {
      expect(hexToBytes(vector.keyHex)).toHaveLength(AEAD_KEY_BYTES)
      expect(hexToBytes(vector.nonceHex)).toHaveLength(AEAD_NONCE_BYTES)
    }
  })

  it('records a ciphertext of plaintext length plus one tag', () => {
    for (const vector of AEAD_REGRESSION_VECTORS) {
      const plaintext = utf8ToBytes(vector.plaintextText)
      expect(hexToBytes(vector.ciphertextHex)).toHaveLength(plaintext.length + AEAD_TAG_BYTES)
    }
  })
})
