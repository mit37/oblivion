import { describe, expect, it } from 'vitest'

import { MalformedPayloadError } from '../crypto/errors'
import { FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import {
  AUTO_LOCK_CHOICES_MINUTES,
  DEFAULT_AUTO_LOCK_MINUTES,
  VAULT_SCHEMA_VERSION,
  clampAddressIndex,
  clampAutoLockMinutes,
  createEmptyDocument,
  isCurrentSchema,
  migrateDocument,
  type VaultDocument,
} from './schema'

const CREATED_AT = '2026-09-25T10:00:00.000Z'

function validDocument(): VaultDocument {
  return createEmptyDocument({
    mnemonic: FIRST_BIP39_TEST_MNEMONIC,
    wordCount: 12,
    createdAt: CREATED_AT,
    kdfProfile: 'interactive',
  })
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...validDocument(), ...overrides } as unknown as Record<string, unknown>
}

describe('createEmptyDocument', () => {
  it('stamps the current schema version', () => {
    expect(validDocument().schemaVersion).toBe(VAULT_SCHEMA_VERSION)
  })

  it('stores the mnemonic, word count and creation time', () => {
    const document = validDocument()
    expect(document.identity.mnemonic).toBe(FIRST_BIP39_TEST_MNEMONIC)
    expect(document.identity.wordCount).toBe(12)
    expect(document.identity.createdAt).toBe(CREATED_AT)
  })

  it('defaults the auto-lock timeout', () => {
    expect(validDocument().settings.autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })

  it('clamps an unsupported auto-lock timeout', () => {
    const document = createEmptyDocument({
      mnemonic: FIRST_BIP39_TEST_MNEMONIC,
      wordCount: 12,
      createdAt: CREATED_AT,
      kdfProfile: 'interactive',
      autoLockMinutes: 7,
    })
    expect(document.settings.autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })

  it('accepts every offered auto-lock timeout', () => {
    for (const minutes of AUTO_LOCK_CHOICES_MINUTES) {
      const document = createEmptyDocument({
        mnemonic: FIRST_BIP39_TEST_MNEMONIC,
        wordCount: 12,
        createdAt: CREATED_AT,
        kdfProfile: 'interactive',
        autoLockMinutes: minutes,
      })
      expect(document.settings.autoLockMinutes).toBe(minutes)
    }
  })

  it('starts with no contacts, messages, payments or tokens', () => {
    const document = validDocument()
    expect(document.contacts).toHaveLength(0)
    expect(document.messages).toHaveLength(0)
    expect(document.payments).toHaveLength(0)
    expect(document.tokens).toHaveLength(0)
  })

  it('normalizes a messy mnemonic', () => {
    const document = createEmptyDocument({
      mnemonic: `  ${FIRST_BIP39_TEST_MNEMONIC.toUpperCase()}  `,
      wordCount: 12,
      createdAt: CREATED_AT,
      kdfProfile: 'interactive',
    })
    expect(document.identity.mnemonic).toBe(FIRST_BIP39_TEST_MNEMONIC)
  })
})

describe('migrateDocument', () => {
  it('accepts a document produced by createEmptyDocument', () => {
    expect(migrateDocument(validPayload())).toEqual(validDocument())
  })

  it('reports the schema as current', () => {
    expect(isCurrentSchema(migrateDocument(validPayload()))).toBe(true)
  })

  it('rejects a non-object payload', () => {
    expect(() => migrateDocument('nope')).toThrow(MalformedPayloadError)
    expect(() => migrateDocument(42)).toThrow(MalformedPayloadError)
  })

  it('rejects null', () => {
    expect(() => migrateDocument(null)).toThrow(MalformedPayloadError)
  })

  it('rejects an array', () => {
    expect(() => migrateDocument([])).toThrow(MalformedPayloadError)
  })

  it('rejects a missing identity section', () => {
    expect(() => migrateDocument(validPayload({ identity: undefined }))).toThrow(
      MalformedPayloadError,
    )
  })

  it('rejects an identity that is not an object', () => {
    expect(() => migrateDocument(validPayload({ identity: 'mnemonic' }))).toThrow(
      MalformedPayloadError,
    )
  })

  it('rejects a mnemonic that is not BIP-39', () => {
    expect(() =>
      migrateDocument(
        validPayload({ identity: { mnemonic: 'not a mnemonic', createdAt: CREATED_AT } }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('rejects an empty mnemonic', () => {
    expect(() =>
      migrateDocument(validPayload({ identity: { mnemonic: '', createdAt: CREATED_AT } })),
    ).toThrow(MalformedPayloadError)
  })

  it('rejects a missing createdAt', () => {
    expect(() =>
      migrateDocument(validPayload({ identity: { mnemonic: FIRST_BIP39_TEST_MNEMONIC } })),
    ).toThrow(MalformedPayloadError)
  })

  it('rejects a createdAt that is not a timestamp', () => {
    expect(() =>
      migrateDocument(
        validPayload({ identity: { mnemonic: FIRST_BIP39_TEST_MNEMONIC, createdAt: 'yesterday' } }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('recovers the word count from the mnemonic instead of trusting the file', () => {
    const document = migrateDocument(
      validPayload({
        identity: { mnemonic: FIRST_BIP39_TEST_MNEMONIC, createdAt: CREATED_AT, wordCount: 24 },
      }),
    )
    expect(document.identity.wordCount).toBe(12)
  })

  it('defaults a missing settings section', () => {
    const document = migrateDocument(validPayload({ settings: undefined }))
    expect(document.settings).toEqual({
      kdfProfile: 'interactive',
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      addressIndex: 0,
    })
  })

  it('refuses to keep the weak test profile in a stored document', () => {
    const document = migrateDocument(validPayload({ settings: { kdfProfile: 'test' } }))
    expect(document.settings.kdfProfile).toBe('interactive')
  })

  it('keeps a supported profile', () => {
    const document = migrateDocument(validPayload({ settings: { kdfProfile: 'sensitive' } }))
    expect(document.settings.kdfProfile).toBe('sensitive')
  })

  it('clamps an unsupported auto-lock value', () => {
    const document = migrateDocument(validPayload({ settings: { autoLockMinutes: 999 } }))
    expect(document.settings.autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })

  it('keeps a supported auto-lock value', () => {
    const document = migrateDocument(validPayload({ settings: { autoLockMinutes: 60 } }))
    expect(document.settings.autoLockMinutes).toBe(60)
  })

  it('clamps a negative address index to zero', () => {
    const document = migrateDocument(validPayload({ settings: { addressIndex: -3 } }))
    expect(document.settings.addressIndex).toBe(0)
  })

  it('defaults missing collections to empty arrays', () => {
    const document = migrateDocument(
      validPayload({ contacts: undefined, messages: [], payments: null, tokens: undefined }),
    )
    expect(document.contacts).toEqual([])
    expect(document.messages).toEqual([])
    expect(document.payments).toEqual([])
    expect(document.tokens).toEqual([])
  })

  it('upgrades a version 1 document by adding an empty token list', () => {
    const document = migrateDocument(validPayload({ schemaVersion: 1, tokens: undefined }))

    expect(document.schemaVersion).toBe(VAULT_SCHEMA_VERSION)
    expect(document.tokens).toEqual([])
  })

  it('keeps a watched token and its decimals', () => {
    const document = migrateDocument(
      validPayload({
        tokens: [
          { address: `0x${'33'.repeat(20)}`, name: 'Test USD', symbol: 'TUSD', decimals: 6 },
        ],
      }),
    )

    expect(document.tokens[0]?.symbol).toBe('TUSD')
    expect(document.tokens[0]?.decimals).toBe(6)
  })

  it('defaults missing token decimals to 18', () => {
    const document = migrateDocument(
      validPayload({ tokens: [{ address: `0x${'33'.repeat(20)}`, name: 'X', symbol: 'X' }] }),
    )

    expect(document.tokens[0]?.decimals).toBe(18)
  })

  it('rejects a token without a valid address', () => {
    expect(() =>
      migrateDocument(
        validPayload({ tokens: [{ address: '0x12', name: 'X', symbol: 'X', decimals: 18 }] }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('rejects an implausible token decimals value', () => {
    expect(() =>
      migrateDocument(
        validPayload({
          tokens: [{ address: `0x${'33'.repeat(20)}`, name: 'X', symbol: 'X', decimals: 99 }],
        }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('rejects a collection that is not an array', () => {
    expect(() => migrateDocument(validPayload({ contacts: {} }))).toThrow(MalformedPayloadError)
  })

  it('keeps a valid contact', () => {
    const document = migrateDocument(
      validPayload({
        contacts: [
          {
            id: 'contact-1',
            label: 'Ada',
            identity: 'oblivion1abc',
            publicKey: `0x02${'ab'.repeat(32)}`,
            addedAt: CREATED_AT,
          },
        ],
      }),
    )
    expect(document.contacts).toHaveLength(1)
    expect(document.contacts[0]?.label).toBe('Ada')
  })

  it('rejects a contact missing required fields', () => {
    expect(() => migrateDocument(validPayload({ contacts: [{ id: 'contact-1' }] }))).toThrow(
      MalformedPayloadError,
    )
  })

  it('keeps a valid message', () => {
    const document = migrateDocument(
      validPayload({
        messages: [
          {
            id: 'message-1',
            conversationId: 'conversation-1',
            direction: 'outbound',
            body: 'hello',
            sentAt: CREATED_AT,
            kind: 'text',
          },
        ],
      }),
    )
    expect(document.messages[0]?.body).toBe('hello')
  })

  it('rejects an unknown message kind', () => {
    expect(() =>
      migrateDocument(
        validPayload({
          messages: [
            {
              id: 'message-1',
              conversationId: 'c',
              direction: 'inbound',
              body: 'x',
              sentAt: CREATED_AT,
              kind: 'video',
            },
          ],
        }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('rejects an unknown message direction', () => {
    expect(() =>
      migrateDocument(
        validPayload({
          messages: [
            {
              id: 'message-1',
              conversationId: 'c',
              direction: 'sideways',
              body: 'x',
              sentAt: CREATED_AT,
              kind: 'text',
            },
          ],
        }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('keeps a payment that carries a transaction hash', () => {
    const document = migrateDocument(
      validPayload({
        payments: [
          {
            id: 'payment-1',
            conversationId: 'c',
            role: 'requested',
            amountWei: '1000000000000000',
            from: `0x${'11'.repeat(20)}`,
            to: `0x${'22'.repeat(20)}`,
            status: 'paid',
            requestedAt: CREATED_AT,
            paidAt: CREATED_AT,
            txHash: `0x${'ab'.repeat(32)}`,
          },
        ],
      }),
    )
    expect(document.payments[0]?.txHash).toBe(`0x${'ab'.repeat(32)}`)
    expect(document.payments[0]?.status).toBe('paid')
  })

  it('rejects a payment with an unknown status', () => {
    expect(() =>
      migrateDocument(
        validPayload({
          payments: [
            {
              id: 'payment-1',
              conversationId: 'c',
              role: 'requested',
              amountWei: '1',
              from: '0x1',
              to: '0x2',
              status: 'pending',
              requestedAt: CREATED_AT,
            },
          ],
        }),
      ),
    ).toThrow(MalformedPayloadError)
  })

  it('drops fields it does not understand', () => {
    const document = migrateDocument(
      validPayload({ somethingElse: 'ignored' }),
    ) as unknown as Record<string, unknown>
    expect(document.somethingElse).toBeUndefined()
  })
})

describe('clamp helpers', () => {
  it('clamps auto-lock minutes to the offered choices', () => {
    expect(clampAutoLockMinutes(undefined)).toBe(DEFAULT_AUTO_LOCK_MINUTES)
    expect(clampAutoLockMinutes(Number.NaN)).toBe(DEFAULT_AUTO_LOCK_MINUTES)
    expect(clampAutoLockMinutes(5)).toBe(5)
    expect(clampAutoLockMinutes(5.4)).toBe(5)
    expect(clampAutoLockMinutes(0)).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })

  it('clamps address indices into the non-hardened range', () => {
    expect(clampAddressIndex(undefined)).toBe(0)
    expect(clampAddressIndex(-1)).toBe(0)
    expect(clampAddressIndex(1.5)).toBe(0)
    expect(clampAddressIndex(2 ** 31)).toBe(0)
    expect(clampAddressIndex(3)).toBe(3)
  })
})
