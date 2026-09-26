import { describe, expect, it } from 'vitest'

import { hexToBytes } from './encoding'
import { InvalidKeyMaterialError, MalformedPayloadError } from './errors'
import { deriveMessagingIdentity, deriveWalletAccount } from './keys'
import { SIGNATURE_BYTES, signBytes, signText, verifyBytes, verifyText } from './signatures'
import { EVM_TEST_MNEMONIC, FIRST_BIP39_TEST_MNEMONIC } from './vectors'

const identity = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
const otherIdentity = deriveMessagingIdentity(EVM_TEST_MNEMONIC)

describe('signText / verifyText', () => {
  it('signs and verifies a message', () => {
    const signature = signText(identity.privateKey, 'hello oblivion')
    expect(verifyText(identity.publicKey, 'hello oblivion', signature)).toBe(true)
  })

  it('produces a 64-byte compact signature', () => {
    expect(hexToBytes(signText(identity.privateKey, 'hello'))).toHaveLength(SIGNATURE_BYTES)
  })

  it('is deterministic (RFC 6979) for the same key and payload', () => {
    expect(signText(identity.privateKey, 'same input')).toBe(
      signText(identity.privateKey, 'same input'),
    )
  })

  it('rejects a payload that changed', () => {
    const signature = signText(identity.privateKey, 'original')
    expect(verifyText(identity.publicKey, 'tampered', signature)).toBe(false)
  })

  it('rejects a signature from another key', () => {
    const signature = signText(otherIdentity.privateKey, 'hello')
    expect(verifyText(identity.publicKey, 'hello', signature)).toBe(false)
  })

  it('rejects a tampered signature', () => {
    const signature = signText(identity.privateKey, 'hello')
    const tampered = `${signature.slice(0, -2)}${signature.endsWith('00') ? '01' : '00'}`
    expect(verifyText(identity.publicKey, 'hello', tampered)).toBe(false)
  })

  it('rejects a signature of the wrong length', () => {
    expect(verifyText(identity.publicKey, 'hello', '0xdeadbeef')).toBe(false)
  })

  it('verifies signatures over unicode text', () => {
    const signature = signText(identity.privateKey, '🔐 日本語')
    expect(verifyText(identity.publicKey, '🔐 日本語', signature)).toBe(true)
  })
})

describe('signBytes / verifyBytes', () => {
  it('round-trips raw bytes', () => {
    const payload = Uint8Array.from([0, 1, 2, 3, 255])
    expect(verifyBytes(identity.publicKey, payload, signBytes(identity.privateKey, payload))).toBe(
      true,
    )
  })

  it('rejects a single flipped payload byte', () => {
    const payload = Uint8Array.from([0, 1, 2, 3, 255])
    const signature = signBytes(identity.privateKey, payload)
    expect(verifyBytes(identity.publicKey, Uint8Array.from([0, 1, 2, 3, 254]), signature)).toBe(
      false,
    )
  })
})

describe('input validation', () => {
  it('throws when the private key is malformed', () => {
    expect(() => signText('0xdeadbeef', 'hello')).toThrow(InvalidKeyMaterialError)
    expect(() => signText('0x00'.padEnd(66, '0'), 'hello')).toThrow(InvalidKeyMaterialError)
  })

  it('throws when the public key is not a valid point', () => {
    const invalidPoint = '0x02' + 'ff'.repeat(32)
    expect(() => verifyText(invalidPoint, 'hello', '0x' + '00'.repeat(64))).toThrow(
      MalformedPayloadError,
    )
  })

  it('does not verify a signature made with the wallet key', () => {
    const wallet = deriveWalletAccount(FIRST_BIP39_TEST_MNEMONIC)
    const signature = signText(wallet.privateKey, 'hello')
    expect(verifyText(identity.publicKey, 'hello', signature)).toBe(false)
  })
})
