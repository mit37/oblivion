import { describe, expect, it } from 'vitest'

import { deriveMessagingIdentity, type HexString } from '../crypto/keys'
import { bytesToUtf8, utf8ToBytes } from '../crypto/encoding'
import { EVM_TEST_MNEMONIC, FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import {
  MESSAGE_ENVELOPE_VERSION,
  decodePayload,
  encodePayload,
  headerBytes,
  openMessage,
  parseMessagePayload,
  sealMessage,
  type MessagePayload,
} from './envelope'
import { InvalidEnvelopeError } from './errors'
import { conversationIdFor } from './identity'

const ALICE = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
const BOB = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
const ALICE_BOB = conversationIdFor(ALICE.publicKey, BOB.publicKey)
const SENT_AT = '2026-09-25T12:00:00.000Z'

async function sealedByAlice(overrides: Partial<Parameters<typeof sealMessage>[0]> = {}) {
  return sealMessage({
    plaintext: 'meet me at the usual place',
    senderPrivateKey: ALICE.privateKey,
    senderPublicKey: ALICE.publicKey,
    recipientPublicKey: BOB.publicKey,
    conversationId: ALICE_BOB,
    sentAt: SENT_AT,
    ...overrides,
  })
}

describe('sealMessage', () => {
  it('produces a versioned payload for the conversation', async () => {
    const payload = await sealedByAlice()

    expect(payload.version).toBe(MESSAGE_ENVELOPE_VERSION)
    expect(payload.conversationId).toBe(ALICE_BOB)
    expect(payload.senderPublicKey).toBe(ALICE.publicKey)
    expect(payload.sentAt).toBe(SENT_AT)
  })

  it('uses a fresh ephemeral key per message', async () => {
    const first = await sealedByAlice()
    const second = await sealedByAlice()

    expect(first.ephemeralPublicKey).not.toBe(second.ephemeralPublicKey)
    expect(first.sealed).not.toBe(second.sealed)
  })

  it('does not leak the plaintext anywhere in the payload', async () => {
    const payload = await sealedByAlice()

    expect(JSON.stringify(payload)).not.toContain('usual place')
    expect(payload.sealed.startsWith('oc1.')).toBe(true)
  })

  it('refuses an empty plaintext at the service level, but seals what it is given', async () => {
    const payload = await sealedByAlice({ plaintext: '' })
    const opened = await openMessage({
      payload,
      recipientPrivateKey: BOB.privateKey,
      conversationId: ALICE_BOB,
    })

    expect(opened.plaintext).toBe('')
  })
})

describe('openMessage', () => {
  it('round-trips a message from Alice to Bob', async () => {
    const payload = await sealedByAlice()

    const opened = await openMessage({
      payload,
      recipientPrivateKey: BOB.privateKey,
      conversationId: ALICE_BOB,
      expectedSenderPublicKey: ALICE.publicKey,
    })

    expect(opened.plaintext).toBe('meet me at the usual place')
    expect(opened.senderPublicKey).toBe(ALICE.publicKey)
    expect(opened.sentAt).toBe(SENT_AT)
  })

  it('cannot be opened by a third party', async () => {
    const mallory = deriveMessagingIdentity('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')
    const payload = await sealedByAlice()

    await expect(
      openMessage({ payload, recipientPrivateKey: mallory.privateKey, conversationId: ALICE_BOB }),
    ).rejects.toThrow()
  })

  it('refuses a payload for another conversation', async () => {
    const mallory = deriveMessagingIdentity('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')
    const other = conversationIdFor(ALICE.publicKey, mallory.publicKey)
    const payload = await sealedByAlice()

    await expect(
      openMessage({ payload, recipientPrivateKey: BOB.privateKey, conversationId: other }),
    ).rejects.toThrow(InvalidEnvelopeError)
  })

  it('refuses a message attributed to the wrong sender', async () => {
    const payload = await sealedByAlice()

    await expect(
      openMessage({
        payload,
        recipientPrivateKey: BOB.privateKey,
        conversationId: ALICE_BOB,
        expectedSenderPublicKey: BOB.publicKey,
      }),
    ).rejects.toThrow(/different key than the subject/)
  })

  it('rejects a flipped signature', async () => {
    const payload = await sealedByAlice()
    const signature = `0x${'0'.repeat(128)}` as HexString

    await expect(
      openMessage({
        payload: { ...payload, signature },
        recipientPrivateKey: BOB.privateKey,
        conversationId: ALICE_BOB,
      }),
    ).rejects.toThrow(/signature does not match/)
  })

  it('rejects a re-labelled timestamp', async () => {
    const payload = await sealedByAlice()

    await expect(
      openMessage({
        payload: { ...payload, sentAt: '2027-01-01T00:00:00.000Z' },
        recipientPrivateKey: BOB.privateKey,
        conversationId: ALICE_BOB,
      }),
    ).rejects.toThrow(InvalidEnvelopeError)
  })

  it('rejects a swapped ephemeral key', async () => {
    const payload = await sealedByAlice()
    const other = await sealedByAlice()

    await expect(
      openMessage({
        payload: { ...payload, ephemeralPublicKey: other.ephemeralPublicKey },
        recipientPrivateKey: BOB.privateKey,
        conversationId: ALICE_BOB,
      }),
    ).rejects.toThrow(InvalidEnvelopeError)
  })

  it('rejects a flipped ciphertext byte', async () => {
    const payload = await sealedByAlice()
    const flipped = flipLastCharacter(payload.sealed)

    await expect(
      openMessage({
        payload: { ...payload, sealed: flipped },
        recipientPrivateKey: BOB.privateKey,
        conversationId: ALICE_BOB,
      }),
    ).rejects.toThrow()
  })

  it('cannot be replayed into another conversation by relabelling its id', async () => {
    const payload = await sealedByAlice()
    const mallory = deriveMessagingIdentity('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')
    const other = conversationIdFor(ALICE.publicKey, mallory.publicKey)

    await expect(
      openMessage({
        payload: { ...payload, conversationId: other },
        recipientPrivateKey: BOB.privateKey,
        conversationId: other,
      }),
    ).rejects.toThrow()
  })
})

describe('wire format', () => {
  it('round-trips through bytes', async () => {
    const payload = await sealedByAlice()
    const decoded = decodePayload(encodePayload(payload))

    expect(decoded).toEqual(payload)
  })

  it('refuses bytes that are not JSON', () => {
    expect(() => decodePayload(utf8ToBytes('not json'))).toThrow(InvalidEnvelopeError)
  })

  it('refuses a non-object payload', () => {
    expect(() => parseMessagePayload('payload')).toThrow(InvalidEnvelopeError)
    expect(() => parseMessagePayload(null)).toThrow(InvalidEnvelopeError)
    expect(() => parseMessagePayload([1, 2])).toThrow(InvalidEnvelopeError)
  })

  it('refuses another version', async () => {
    const payload = await sealedByAlice()

    expect(() => parseMessagePayload({ ...payload, version: 'om2' })).toThrow(
      /unsupported message version/,
    )
  })

  it('refuses a missing or malformed field', async () => {
    const payload = await sealedByAlice()

    expect(() => parseMessagePayload({ ...payload, sealed: undefined })).toThrow(
      InvalidEnvelopeError,
    )
    expect(() => parseMessagePayload({ ...payload, sealed: 'plain' })).toThrow(InvalidEnvelopeError)
    expect(() => parseMessagePayload({ ...payload, signature: '0x1234' })).toThrow(
      InvalidEnvelopeError,
    )
    expect(() => parseMessagePayload({ ...payload, senderPublicKey: '0x02' })).toThrow(
      InvalidEnvelopeError,
    )
    expect(() => parseMessagePayload({ ...payload, sentAt: 'yesterday' })).toThrow(
      InvalidEnvelopeError,
    )
  })

  it('refuses a public key that is not on the curve', () => {
    const payload = {
      version: MESSAGE_ENVELOPE_VERSION,
      conversationId: ALICE_BOB,
      senderPublicKey: `0x02${'00'.repeat(32)}`,
      ephemeralPublicKey: ALICE.publicKey,
      kind: 'text',
      sentAt: SENT_AT,
      sealed: 'oc1.a.b.c',
      signature: `0x${'ab'.repeat(64)}`,
    }

    expect(() => parseMessagePayload(payload)).toThrow(/not a valid secp256k1 point/)
  })

  it('refuses a conversation id that is not hex', async () => {
    const payload = await sealedByAlice()

    expect(() => parseMessagePayload({ ...payload, conversationId: 'not-a-conversation' })).toThrow(
      InvalidEnvelopeError,
    )
  })

  it('does not carry the plaintext on the wire', async () => {
    const payload = await sealedByAlice({ plaintext: 'a secret phrase' })

    expect(bytesToUtf8(encodePayload(payload))).not.toContain('a secret phrase')
  })
})

describe('headerBytes', () => {
  it('is the same for both sides of a conversation regardless of key case', async () => {
    const payload = await sealedByAlice()

    expect(headerBytes(payload)).toEqual(
      headerBytes({
        conversationId: payload.conversationId,
        senderPublicKey: payload.senderPublicKey.toUpperCase().replace('0X', '0x'),
        ephemeralPublicKey: payload.ephemeralPublicKey,
        kind: payload.kind,
        sentAt: payload.sentAt,
      }),
    )
  })

  it('changes with every part of the header', async () => {
    const payload = await sealedByAlice()
    const base = bytesToUtf8(headerBytes(payload))

    const variations: MessagePayload[] = [
      { ...payload, conversationId: 'f'.repeat(32) },
      { ...payload, sentAt: '2027-01-01T00:00:00.000Z' },
      { ...payload, ephemeralPublicKey: BOB.publicKey },
      { ...payload, senderPublicKey: BOB.publicKey },
      // The kind is authenticated too: a payment cannot be re-labelled as chat.
      { ...payload, kind: 'payment-request' },
    ]

    for (const variant of variations) {
      expect(bytesToUtf8(headerBytes(variant))).not.toBe(base)
    }
  })
})

function flipLastCharacter(value: string): string {
  const last = value.at(-1) ?? 'a'
  return `${value.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`
}
