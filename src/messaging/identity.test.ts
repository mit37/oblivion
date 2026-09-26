import { describe, expect, it } from 'vitest'

import { deriveMessagingIdentity, encodeIdentity, publicKeyFingerprint } from '../crypto/keys'
import { EVM_TEST_MNEMONIC, FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import { InvalidIdentityError } from './errors'
import {
  CONTENT_TOPIC_PREFIX,
  assertConversationId,
  contentTopicFor,
  conversationIdFor,
  conversationKey,
  parseContactIdentity,
} from './identity'

const ALICE = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
const BOB = deriveMessagingIdentity(EVM_TEST_MNEMONIC)

describe('parseContactIdentity', () => {
  it('accepts the identity string a contact shares', async () => {
    const identity = await encodeIdentity(BOB.publicKey)
    const contact = await parseContactIdentity(identity)

    expect(contact.identity).toBe(identity)
    expect(contact.publicKey).toBe(BOB.publicKey)
    expect(contact.fingerprint).toBe(publicKeyFingerprint(BOB.publicKey))
  })

  it('accepts a bare compressed public key and normalises it', async () => {
    const contact = await parseContactIdentity(BOB.publicKey)

    expect(contact.publicKey).toBe(BOB.publicKey)
    expect(contact.identity).toBe(await encodeIdentity(BOB.publicKey))
  })

  it('accepts surrounding whitespace', async () => {
    const identity = await encodeIdentity(BOB.publicKey)
    const contact = await parseContactIdentity(`  ${identity}\n`)

    expect(contact.publicKey).toBe(BOB.publicKey)
  })

  it('refuses anything else', async () => {
    await expect(parseContactIdentity('')).rejects.toThrow(InvalidIdentityError)
    await expect(parseContactIdentity('   ')).rejects.toThrow(InvalidIdentityError)
    await expect(parseContactIdentity('0x1234')).rejects.toThrow(InvalidIdentityError)
    await expect(parseContactIdentity('oblivion1notbase64!!')).rejects.toThrow(InvalidIdentityError)
    await expect(parseContactIdentity('oblivion1')).rejects.toThrow(InvalidIdentityError)
  })

  it('refuses a public key that is not on the curve', async () => {
    await expect(parseContactIdentity(`0x02${'00'.repeat(32)}`)).rejects.toThrow(
      InvalidIdentityError,
    )
  })

  it('refuses the wallet address as a contact identity', async () => {
    // The two identities are deliberately unrelated; pasting one where the other
    // belongs must fail loudly rather than create a contact nobody can reach.
    await expect(
      parseContactIdentity('0xf7A5DAfFb67f3f235a448Bd3b1AD22C0913D90f4'),
    ).rejects.toThrow(InvalidIdentityError)
  })
})

describe('conversationIdFor', () => {
  it('is the same from either side', () => {
    expect(conversationIdFor(ALICE.publicKey, BOB.publicKey)).toBe(
      conversationIdFor(BOB.publicKey, ALICE.publicKey),
    )
  })

  it('ignores key case', () => {
    expect(
      conversationIdFor(
        ALICE.publicKey.toUpperCase().replace('0X', '0x') as `0x${string}`,
        BOB.publicKey,
      ),
    ).toBe(conversationIdFor(ALICE.publicKey, BOB.publicKey))
  })

  it('is different for every pair', () => {
    const mine = deriveMessagingIdentity('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')

    expect(conversationIdFor(ALICE.publicKey, BOB.publicKey)).not.toBe(
      conversationIdFor(ALICE.publicKey, mine.publicKey),
    )
  })

  it('is 32 hex characters, which is what a content topic allows', () => {
    expect(conversationIdFor(ALICE.publicKey, BOB.publicKey)).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('topics', () => {
  it('builds a content topic Waku accepts (RFC 51: four fields)', () => {
    const conversationId = conversationIdFor(ALICE.publicKey, BOB.publicKey)
    const topic = contentTopicFor(conversationId)

    expect(topic).toBe(`${CONTENT_TOPIC_PREFIX}/${conversationId}/proto`)
    // '/oblivion/1/<id>/proto' splits into ['', 'oblivion', '1', '<id>', 'proto']:
    // a fifth field would be read as a generation prefix and rejected.
    expect(topic.split('/')).toHaveLength(5)
    expect(topic.split('/')[3]).toBe(conversationId)
  })

  it('refuses a conversation id that is not 32 hex characters', () => {
    expect(() => contentTopicFor('nope')).toThrow(InvalidIdentityError)
    expect(() => contentTopicFor('ABCDEF'.repeat(6))).toThrow(InvalidIdentityError)
    expect(() => assertConversationId('abcdef')).toThrow(InvalidIdentityError)
  })

  it('names a conversation for the vault', () => {
    const conversationId = conversationIdFor(ALICE.publicKey, BOB.publicKey)
    expect(conversationKey(conversationId)).toBe(`oblivion:dm/${conversationId}`)
  })
})
