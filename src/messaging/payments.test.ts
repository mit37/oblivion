import { describe, expect, it } from 'vitest'

import { deriveWalletAccount } from '../crypto/keys'
import { EVM_TEST_MNEMONIC } from '../crypto/vectors'
import type { MessageKind as VaultMessageKind } from '../vault/schema'
import { MainnetRefusedError, UnsupportedChainError } from '../wallet/chain'
import { MESSAGE_KINDS, type MessageKind } from './envelope'
import { PaymentError } from './errors'
import {
  createPaymentReceipt,
  createPaymentRequest,
  decodePaymentBody,
  decodePaymentReceiptBody,
  decodePaymentRequestBody,
  encodePaymentReceiptBody,
  encodePaymentRequestBody,
  MAX_PAYMENT_NOTE_LENGTH,
  newPaymentRequestId,
  parsePaymentRequestId,
} from './payments'

const PAY_TO = deriveWalletAccount(EVM_TEST_MNEMONIC).address
const TX_HASH = `0x${'cd'.repeat(32)}` as `0x${string}`

function requestBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    requestId: 'pay-'.concat('a'.repeat(32)),
    amountWei: '1000000000000000',
    payTo: PAY_TO,
    payToChainId: 11_155_111,
    note: 'split the faucet drop',
    ...overrides,
  })
}

describe('payment requests', () => {
  it('round-trips a request through the body that gets sealed', () => {
    const request = createPaymentRequest({
      amountWei: 1_000_000_000_000_000n,
      payTo: PAY_TO,
      note: 'split the faucet drop',
    })

    const decoded = decodePaymentRequestBody(encodePaymentRequestBody(request))

    expect(decoded).toEqual(request)
    expect(decoded.amountWei).toBe(1_000_000_000_000_000n)
    expect(decoded.note).toBe('split the faucet drop')
  })

  it('defaults the chain to Sepolia and never to anything else', () => {
    const request = createPaymentRequest({ amountWei: 1n, payTo: PAY_TO })

    expect(request.payToChainId).toBe(11_155_111)
  })

  it('gives every request its own id', () => {
    const first = newPaymentRequestId()
    const second = newPaymentRequestId()

    expect(first).toMatch(/^pay-[0-9a-f]{32}$/)
    expect(second).not.toBe(first)
  })

  it('refuses a request aimed at mainnet, with the wallet’s own refusal', () => {
    expect(() => createPaymentRequest({ amountWei: 1n, payTo: PAY_TO, payToChainId: 1 })).toThrow(
      MainnetRefusedError,
    )

    expect(() => decodePaymentRequestBody(requestBody({ payToChainId: 1 }))).toThrow(
      MainnetRefusedError,
    )
  })

  it('refuses a chain that is neither Sepolia nor mainnet', () => {
    expect(() => createPaymentRequest({ amountWei: 1n, payTo: PAY_TO, payToChainId: 5 })).toThrow(
      UnsupportedChainError,
    )
  })

  it('refuses a body that does not name a chain at all', () => {
    // Defaulting here would turn a missing field into "Sepolia, presumably".
    expect(() => decodePaymentRequestBody(requestBody({ payToChainId: undefined }))).toThrow(
      PaymentError,
    )
  })

  it('refuses an amount that is not a positive whole number of wei', () => {
    expect(() => createPaymentRequest({ amountWei: 0n, payTo: PAY_TO })).toThrow(PaymentError)

    for (const amountWei of ['0', '-1', '0.5', 'abc', '', 1, null]) {
      expect(() => decodePaymentRequestBody(requestBody({ amountWei }))).toThrow(PaymentError)
    }
  })

  it('refuses a recipient that is not an address', () => {
    expect(() => createPaymentRequest({ amountWei: 1n, payTo: '0xnope' })).toThrow(PaymentError)

    expect(() =>
      decodePaymentRequestBody(requestBody({ payTo: '0xf7A5DAfFb67f3f235a448Bd3b1AD22C0913D90f' })),
    ).toThrow(PaymentError)
  })

  it('refuses an id that is not a payment id', () => {
    expect(() => parsePaymentRequestId('pay-nope')).toThrow(PaymentError)
    expect(() => parsePaymentRequestId(undefined)).toThrow(PaymentError)
    expect(() => decodePaymentRequestBody(requestBody({ requestId: 'abc' }))).toThrow(PaymentError)
  })

  it('keeps notes short and trims them', () => {
    const request = createPaymentRequest({ amountWei: 1n, payTo: PAY_TO, note: '  hello  ' })
    expect(request.note).toBe('hello')

    expect(() =>
      createPaymentRequest({
        amountWei: 1n,
        payTo: PAY_TO,
        note: 'x'.repeat(MAX_PAYMENT_NOTE_LENGTH + 1),
      }),
    ).toThrow(PaymentError)
  })

  it('refuses a body that is not an object or not JSON', () => {
    for (const body of ['', 'not json', '[]', 'null', '"a string"']) {
      expect(() => decodePaymentRequestBody(body)).toThrow(PaymentError)
    }
  })

  it('refuses a payload version this build does not know', () => {
    expect(() => decodePaymentRequestBody(requestBody({ version: 99 }))).toThrow(/version/)
  })
})

describe('payment receipts', () => {
  it('carries the transaction hash when it was paid', () => {
    const receipt = createPaymentReceipt({
      requestId: `pay-${'a'.repeat(32)}`,
      status: 'paid',
      txHash: TX_HASH,
      settledAt: '2026-09-26T12:00:00.000Z',
    })

    const decoded = decodePaymentReceiptBody(encodePaymentReceiptBody(receipt))

    expect(decoded.status).toBe('paid')
    expect(decoded.txHash).toBe(TX_HASH)
  })

  it('refuses a paid receipt without a usable hash', () => {
    for (const txHash of [null, '', '0x1234', 42]) {
      expect(() =>
        createPaymentReceipt({
          requestId: `pay-${'a'.repeat(32)}`,
          status: 'paid',
          txHash: txHash as `0x${string}` | null,
          settledAt: '2026-09-26T12:00:00.000Z',
        }),
      ).toThrow(PaymentError)
    }
  })

  it('carries no hash when it was declined', () => {
    const receipt = createPaymentReceipt({
      requestId: `pay-${'a'.repeat(32)}`,
      status: 'declined',
      settledAt: '2026-09-26T12:00:00.000Z',
    })

    expect(receipt.txHash).toBeNull()
    expect(() => decodePaymentReceiptBody(encodePaymentReceiptBody(receipt))).not.toThrow()

    // A declined receipt that still names a hash is refused rather than shown.
    expect(() =>
      decodePaymentReceiptBody(
        JSON.stringify({
          version: 1,
          requestId: `pay-${'a'.repeat(32)}`,
          status: 'declined',
          txHash: TX_HASH,
          settledAt: '2026-09-26T12:00:00.000Z',
        }),
      ),
    ).toThrow(PaymentError)
  })

  it('refuses a status that is neither paid nor declined', () => {
    expect(() =>
      decodePaymentReceiptBody(
        JSON.stringify({
          version: 1,
          requestId: `pay-${'a'.repeat(32)}`,
          status: 'maybe',
          txHash: null,
          settledAt: '2026-09-26T12:00:00.000Z',
        }),
      ),
    ).toThrow(PaymentError)
  })

  it('refuses a settled time that is not a timestamp', () => {
    expect(() =>
      decodePaymentReceiptBody(
        JSON.stringify({
          version: 1,
          requestId: `pay-${'a'.repeat(32)}`,
          status: 'declined',
          txHash: null,
          settledAt: 'yesterday',
        }),
      ),
    ).toThrow(PaymentError)
  })
})

describe('reading a stored body by kind', () => {
  it('returns the request for a request body', () => {
    const request = createPaymentRequest({ amountWei: 5n, payTo: PAY_TO })
    const decoded = decodePaymentBody('payment-request', encodePaymentRequestBody(request))

    expect(decoded?.kind).toBe('payment-request')
  })

  it('returns the receipt for a receipt body', () => {
    const receipt = createPaymentReceipt({
      requestId: `pay-${'a'.repeat(32)}`,
      status: 'declined',
      settledAt: '2026-09-26T12:00:00.000Z',
    })

    expect(decodePaymentBody('payment-receipt', encodePaymentReceiptBody(receipt))?.kind).toBe(
      'payment-receipt',
    )
  })

  it('returns nothing for text, so a chat message is never read as a payment', () => {
    expect(decodePaymentBody('text', '{"amountWei":"1"}')).toBeNull()
    expect(decodePaymentBody('something-else', '{}')).toBeNull()
  })
})

describe('the wire kinds and the vault kinds', () => {
  it('are the same set, in both directions', () => {
    // Both assignments are checked by the compiler: a kind added on the wire and
    // not storable in the vault (or the other way round) fails to build.
    const asVaultKinds: readonly VaultMessageKind[] = MESSAGE_KINDS
    const asWireKinds: readonly MessageKind[] = ['text', 'payment-request', 'payment-receipt']

    expect(new Set(asVaultKinds)).toEqual(new Set(asWireKinds))
  })
})
describe('what the sealed body looks like', () => {
  it('carries the amount as a decimal string, because JSON has no wei-sized integer', () => {
    const request = createPaymentRequest({ amountWei: 12_345_678_901_234_567_890n, payTo: PAY_TO })
    const body = JSON.parse(encodePaymentRequestBody(request)) as { amountWei: unknown }

    expect(body.amountWei).toBe('12345678901234567890')
    expect(typeof body.amountWei).toBe('string')
    expect(decodePaymentRequestBody(JSON.stringify(body)).amountWei).toBe(
      12_345_678_901_234_567_890n,
    )
  })

  it('does not name the requester, only the address that should be paid', () => {
    const request = createPaymentRequest({ amountWei: 1n, payTo: PAY_TO, note: 'lunch' })
    const body = JSON.parse(encodePaymentRequestBody(request)) as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(
      ['amountWei', 'note', 'payTo', 'payToChainId', 'requestId', 'version'].sort(),
    )
  })
})
