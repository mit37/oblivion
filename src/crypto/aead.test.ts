import { describe, expect, it } from 'vitest'

import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  SEALED_ENVELOPE_VERSION,
  open,
  openEnvelope,
  openJson,
  openText,
  seal,
  sealJson,
  sealText,
  sealToEnvelope,
} from './aead'
import { bytesToHex, hexToBytes, utf8ToBytes } from './encoding'
import {
  DecryptionFailedError,
  InvalidKeyMaterialError,
  InvalidParameterError,
  MalformedPayloadError,
} from './errors'
import { AEAD_REGRESSION_VECTORS } from './vectors'

const KEY = Uint8Array.from({ length: AEAD_KEY_BYTES }, (_, index) => index)
const OTHER_KEY = Uint8Array.from({ length: AEAD_KEY_BYTES }, (_, index) => 0xff - index)

describe('seal / open', () => {
  it('round-trips a short message', async () => {
    const box = await seal(KEY, utf8ToBytes('hello oblivion'))
    expect(new TextDecoder().decode(await open(KEY, box))).toBe('hello oblivion')
  })

  it('round-trips an empty message', async () => {
    const box = await seal(KEY, new Uint8Array(0))
    expect((await open(KEY, box)).length).toBe(0)
  })

  it('round-trips a single byte', async () => {
    const box = await seal(KEY, Uint8Array.from([0x42]))
    expect(Array.from(await open(KEY, box))).toEqual([0x42])
  })

  it('round-trips a 64 KiB payload', async () => {
    const plaintext = Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 256)
    const box = await seal(KEY, plaintext)
    expect(await open(KEY, box)).toEqual(plaintext)
  })

  it('uses a 24-byte nonce', async () => {
    const box = await seal(KEY, utf8ToBytes('x'))
    expect(box.nonce).toHaveLength(AEAD_NONCE_BYTES)
  })

  it('adds exactly one authentication tag to the ciphertext', async () => {
    const plaintext = utf8ToBytes('tag length check')
    const box = await seal(KEY, plaintext)
    expect(box.ciphertext.length).toBe(plaintext.length + AEAD_TAG_BYTES)
  })

  it('generates a fresh nonce for every seal', async () => {
    const nonces = new Set(
      await Promise.all(
        Array.from({ length: 32 }, async () =>
          bytesToHex((await seal(KEY, utf8ToBytes('x'))).nonce),
        ),
      ),
    )
    expect(nonces.size).toBe(32)
  })

  it('produces different ciphertext for the same plaintext', async () => {
    const first = await seal(KEY, utf8ToBytes('same input'))
    const second = await seal(KEY, utf8ToBytes('same input'))
    expect(bytesToHex(first.ciphertext)).not.toBe(bytesToHex(second.ciphertext))
  })

  it('round-trips with associated data', async () => {
    const box = await seal(KEY, utf8ToBytes('bound message'), { aad: 'chat/42' })
    expect(new TextDecoder().decode(await open(KEY, box, { expectedAad: 'chat/42' }))).toBe(
      'bound message',
    )
  })

  it('matches the committed AEAD regression vector', async () => {
    const vector = AEAD_REGRESSION_VECTORS[0]
    expect(vector).toBeDefined()

    const box = await seal(KEY, utf8ToBytes(vector.plaintextText), {
      nonce: hexToBytes(vector.nonceHex),
      aad: vector.aadText,
    })

    expect(bytesToHex(box.ciphertext)).toBe(vector.ciphertextHex)
  })
})

describe('tamper detection', () => {
  it('rejects a flipped ciphertext byte', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))
    const tampered = Uint8Array.from(box.ciphertext)
    tampered[0] ^= 0x01

    await expect(open(KEY, { ...box, ciphertext: tampered })).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a flipped authentication-tag byte', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))
    const tampered = Uint8Array.from(box.ciphertext)
    tampered[tampered.length - 1] ^= 0x80

    await expect(open(KEY, { ...box, ciphertext: tampered })).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a flipped nonce byte', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))
    const tampered = Uint8Array.from(box.nonce)
    tampered[7] ^= 0x01

    await expect(open(KEY, { ...box, nonce: tampered })).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a truncated tag', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))
    const truncated = box.ciphertext.slice(0, box.ciphertext.length - 1)

    await expect(open(KEY, { ...box, ciphertext: truncated })).rejects.toThrow(
      DecryptionFailedError,
    )
  })

  it('rejects ciphertext shorter than the tag', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))

    await expect(open(KEY, { ...box, ciphertext: new Uint8Array(8) })).rejects.toThrow(
      DecryptionFailedError,
    )
  })

  it('rejects the wrong key', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))
    await expect(open(OTHER_KEY, box)).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a key of the wrong length', async () => {
    const box = await seal(KEY, utf8ToBytes('tamper me'))
    await expect(open(new Uint8Array(31), box)).rejects.toThrow(InvalidKeyMaterialError)
  })

  it('accepts a record whose own context travels with it', async () => {
    const box = await seal(KEY, utf8ToBytes('bound message'), { aad: 'chat/42' })
    expect(new TextDecoder().decode(await open(KEY, box))).toBe('bound message')
  })

  it('rejects a flipped associated-data byte', async () => {
    const box = await seal(KEY, utf8ToBytes('bound message'), { aad: 'chat/42' })
    const tamperedAad = Uint8Array.from(box.aad ?? new Uint8Array())
    tamperedAad[0] ^= 0x01

    await expect(open(KEY, { ...box, aad: tamperedAad })).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a mismatched expected context', async () => {
    const box = await seal(KEY, utf8ToBytes('bound message'), { aad: 'chat/42' })
    await expect(open(KEY, box, { expectedAad: 'chat/43' })).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects an expected context the record never had', async () => {
    const box = await seal(KEY, utf8ToBytes('unbound message'))
    await expect(open(KEY, box, { expectedAad: 'chat/42' })).rejects.toThrow(DecryptionFailedError)
  })

  it('rejects a nonce of the wrong length when sealing', async () => {
    await expect(seal(KEY, utf8ToBytes('x'), { nonce: new Uint8Array(12) })).rejects.toThrow(
      InvalidParameterError,
    )
  })

  it('rejects a nonce of the wrong length when opening', async () => {
    const box = await seal(KEY, utf8ToBytes('x'))
    await expect(open(KEY, { ...box, nonce: new Uint8Array(12) })).rejects.toThrow(
      InvalidParameterError,
    )
  })

  it('rejects a plaintext that is not a Uint8Array', async () => {
    await expect(seal(KEY, 'text' as unknown as Uint8Array)).rejects.toThrow(InvalidParameterError)
  })

  it('rejects a key that is not a Uint8Array', async () => {
    await expect(seal('key' as unknown as Uint8Array, utf8ToBytes('x'))).rejects.toThrow(
      InvalidKeyMaterialError,
    )
  })
})

describe('sealed envelope format', () => {
  it('round-trips through sealToEnvelope and openEnvelope', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('enveloped'))
    expect(new TextDecoder().decode(await openEnvelope(KEY, envelope))).toBe('enveloped')
  })

  it('starts with the version tag and has four parts', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('enveloped'))
    const parts = envelope.split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe(SEALED_ENVELOPE_VERSION)
  })

  it('marks a missing associated data field with a dash', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('enveloped'))
    expect(envelope.split('.')[2]).toBe('-')
  })

  it('carries associated data through the envelope', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('bound'), { aad: 'vault/identity' })
    expect(
      new TextDecoder().decode(
        await openEnvelope(KEY, envelope, { expectedAad: 'vault/identity' }),
      ),
    ).toBe('bound')
  })

  it('rejects a record moved into another context', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('bound'), { aad: 'vault/identity' })
    await expect(openEnvelope(KEY, envelope, { expectedAad: 'vault/wallet' })).rejects.toThrow(
      DecryptionFailedError,
    )
  })

  it('rejects an unknown version tag', async () => {
    await expect(openEnvelope(KEY, 'oc2.a.b.c')).rejects.toThrow(MalformedPayloadError)
  })

  it('rejects the wrong number of parts', async () => {
    await expect(openEnvelope(KEY, 'oc1.a.b')).rejects.toThrow(MalformedPayloadError)
    await expect(openEnvelope(KEY, 'oc1.a.b.c.d')).rejects.toThrow(MalformedPayloadError)
  })

  it('rejects malformed base64 in any field', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('enveloped'))
    const parts = envelope.split('.')
    parts[3] = '%%%not-base64%%%'
    await expect(openEnvelope(KEY, parts.join('.'))).rejects.toThrow(MalformedPayloadError)
  })

  it('rejects a non-string envelope', async () => {
    await expect(openEnvelope(KEY, null as unknown as string)).rejects.toThrow(
      MalformedPayloadError,
    )
  })

  it('rejects a tampered envelope end to end', async () => {
    const envelope = await sealToEnvelope(KEY, utf8ToBytes('enveloped'))
    const parts = envelope.split('.')
    const ciphertextPart = parts[3]
    // Rewriting the first base64 character always changes the first ciphertext byte.
    parts[3] = `${ciphertextPart.startsWith('A') ? 'B' : 'A'}${ciphertextPart.slice(1)}`

    await expect(openEnvelope(KEY, parts.join('.'))).rejects.toThrow(DecryptionFailedError)
  })
})

describe('text and JSON helpers', () => {
  it('round-trips unicode text', async () => {
    const text = '🔐 chat with 日本語 — ok'
    expect(await openText(KEY, await sealText(KEY, text))).toBe(text)
  })

  it('round-trips a JSON record', async () => {
    const record = { kind: 'message', body: 'hi', sentAt: 1_756_000_000_000 }
    expect(await openJson(KEY, await sealJson(KEY, record))).toEqual(record)
  })

  it('binds a JSON record to its context', async () => {
    const envelope = await sealJson(KEY, { account: 0 }, { aad: 'vault/wallet' })
    await expect(openJson(KEY, envelope, { expectedAad: 'vault/chats' })).rejects.toThrow(
      DecryptionFailedError,
    )
  })

  it('rejects a non-JSON payload when JSON was expected', async () => {
    const envelope = await sealText(KEY, 'definitely not json')
    await expect(openJson(KEY, envelope)).rejects.toThrow(MalformedPayloadError)
  })
})
