/**
 * Pay-in-chat payloads.
 *
 * A payment request and its receipt travel as ordinary sealed direct messages:
 * same envelope, same per-message key, same signature. What marks them out is
 * the message *kind*, which sits in the signed header (and is authenticated as
 * associated data), so the bytes below are read as a payment only when the
 * sender said so — a text message that happens to look like JSON stays text.
 *
 * Everything here is validated before it is shown or sealed. A request for an
 * amount that is not a positive whole number of wei, an address that is not a
 * 20-byte address, or a chain id that is not Sepolia is refused rather than
 * rendered as a button, and the Sepolia guard is the same one the wallet uses,
 * so a pay-in-chat request can never point at mainnet.
 */
import { bytesToHex } from '../crypto/encoding'
import type { HexString } from '../crypto/keys'
import { randomBytes } from '../crypto/random'
import { SEPOLIA_CHAIN_ID, assertSepoliaChainId } from '../wallet/chain'
import { assertAddress } from '../wallet/format'
import { PaymentError } from './errors'

/** Bumped only if the JSON shape below changes incompatibly. */
export const PAYMENT_PAYLOAD_VERSION = 1

/** Longest note a request may carry. Short on purpose: it is a payment, not a letter. */
export const MAX_PAYMENT_NOTE_LENGTH = 200

export interface PaymentRequest {
  readonly version: number
  /** 16 random bytes in hex; the id both sides quote back and forth. */
  readonly requestId: string
  readonly amountWei: bigint
  /** Where the money goes — the requester's own wallet address. */
  readonly payTo: HexString
  readonly payToChainId: number
  readonly note: string
}

export type PaymentReceiptStatus = 'paid' | 'declined'

export interface PaymentReceipt {
  readonly version: number
  readonly requestId: string
  readonly status: PaymentReceiptStatus
  /** Present when paid; null when declined. */
  readonly txHash: HexString | null
  readonly settledAt: string
}

/** What the caller supplies to ask for money: the rest is derived or generated. */
export interface PaymentRequestDraft {
  readonly amountWei: bigint
  readonly payTo: HexString
  readonly note?: string
  /** Tests only: pin the id so a submission is reproducible. */
  readonly requestId?: string
  readonly payToChainId?: number
}

export function newPaymentRequestId(): string {
  return `pay-${bytesToHex(randomBytes(16))}`
}

export function parsePaymentRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^pay-[0-9a-f]{32}$/.test(value)) {
    throw new PaymentError('a payment id looks like pay- followed by 32 hex characters')
  }

  return value
}

export function createPaymentRequest(draft: PaymentRequestDraft): PaymentRequest {
  const payToChainId = draft.payToChainId ?? SEPOLIA_CHAIN_ID

  assertPaymentChain(payToChainId)

  return {
    version: PAYMENT_PAYLOAD_VERSION,
    requestId: draft.requestId ? parsePaymentRequestId(draft.requestId) : newPaymentRequestId(),
    amountWei: assertAmount(draft.amountWei),
    payTo: assertPayTo(draft.payTo),
    payToChainId,
    note: assertNote(draft.note ?? ''),
  }
}

/**
 * The JSON that goes inside the sealed body. Amounts are decimal strings
 * because JSON has no integers big enough to hold wei.
 */
export function encodePaymentRequestBody(request: PaymentRequest): string {
  return JSON.stringify({
    version: request.version,
    requestId: request.requestId,
    amountWei: request.amountWei.toString(),
    payTo: request.payTo,
    payToChainId: request.payToChainId,
    note: request.note,
  })
}

export function decodePaymentRequestBody(body: string): PaymentRequest {
  const record = asRecord(parseJson(body), 'payment request')

  if (record.version !== PAYMENT_PAYLOAD_VERSION) {
    throw new PaymentError(`unsupported payment payload version "${String(record.version)}"`)
  }

  // A body must name the chain it is for; defaulting here would turn a missing
  // field into "Sepolia, presumably", which is exactly the guess this module is
  // supposed to refuse.
  assertPaymentChain(record.payToChainId)

  return {
    version: PAYMENT_PAYLOAD_VERSION,
    requestId: parsePaymentRequestId(record.requestId),
    amountWei: asWei(record.amountWei),
    payTo: asAddressString(record.payTo),
    payToChainId: record.payToChainId,
    note: asNote(record.note),
  }
}

export function encodePaymentReceiptBody(receipt: PaymentReceipt): string {
  return JSON.stringify({
    version: receipt.version,
    requestId: receipt.requestId,
    status: receipt.status,
    txHash: receipt.txHash,
    settledAt: receipt.settledAt,
  })
}

export function decodePaymentReceiptBody(body: string): PaymentReceipt {
  const record = asRecord(parseJson(body), 'payment receipt')

  if (record.version !== PAYMENT_PAYLOAD_VERSION) {
    throw new PaymentError(`unsupported payment payload version "${String(record.version)}"`)
  }

  const status = record.status

  if (status !== 'paid' && status !== 'declined') {
    throw new PaymentError('a receipt says whether the payment was paid or declined')
  }

  const txHash = record.txHash

  if (status === 'paid') {
    if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new PaymentError('a paid receipt must carry the 32-byte transaction hash')
    }
  } else if (txHash !== null && txHash !== undefined) {
    throw new PaymentError('a declined receipt carries no transaction hash')
  }

  return {
    version: PAYMENT_PAYLOAD_VERSION,
    requestId: parsePaymentRequestId(record.requestId),
    status,
    txHash: status === 'paid' ? ((txHash as string).toLowerCase() as HexString) : null,
    settledAt: asTimestamp(record.settledAt, 'settledAt'),
  }
}

/** The bytes a receipt carries, ready for `sendPaymentReceipt`. */
export function createPaymentReceipt(input: {
  readonly requestId: string
  readonly status: PaymentReceiptStatus
  readonly txHash?: HexString | null
  readonly settledAt: string
}): PaymentReceipt {
  return decodePaymentReceiptBody(
    JSON.stringify({
      version: PAYMENT_PAYLOAD_VERSION,
      requestId: input.requestId,
      status: input.status,
      txHash: input.status === 'paid' ? (input.txHash ?? null) : null,
      settledAt: input.settledAt,
    }),
  )
}

/** Both sides of the flow, for the UI to render one stored body. */
export type PaymentPayload =
  | { readonly kind: 'payment-request'; readonly request: PaymentRequest }
  | { readonly kind: 'payment-receipt'; readonly receipt: PaymentReceipt }

/**
 * Reads a stored or arriving payment body. Returns `null` for a text message, so
 * callers can branch without guessing; throws for a payment body that does not
 * validate.
 */
export function decodePaymentBody(kind: string, body: string): PaymentPayload | null {
  if (kind === 'payment-request') {
    return { kind: 'payment-request', request: decodePaymentRequestBody(body) }
  }

  if (kind === 'payment-receipt') {
    return { kind: 'payment-receipt', receipt: decodePaymentReceiptBody(body) }
  }

  return null
}

/**
 * The chain a request may name: Sepolia, and nothing else.
 *
 * The refusal is the wallet's own (`assertSepoliaChainId`), so a pay-in-chat
 * request aimed at mainnet fails with the same `MainnetRefusedError` the
 * wallet raises — one policy, one error, in both places.
 */
export function assertPaymentChain(chainId: unknown): asserts chainId is number {
  if (typeof chainId !== 'number' || !Number.isInteger(chainId)) {
    throw new PaymentError('a payment request must name a chain id')
  }

  assertSepoliaChainId(chainId)
}

function assertAmount(amountWei: bigint): bigint {
  if (typeof amountWei !== 'bigint' || amountWei <= 0n) {
    throw new PaymentError('a payment request must be for more than zero wei')
  }

  return amountWei
}

function asWei(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new PaymentError('a payment amount must be a whole number of wei')
  }

  return assertAmount(BigInt(value))
}

function assertPayTo(value: unknown): HexString {
  if (typeof value !== 'string') {
    throw new PaymentError('a payment request must name a recipient address')
  }

  try {
    return assertAddress(value, 'payment recipient')
  } catch (cause) {
    throw new PaymentError(
      cause instanceof Error ? cause.message : 'the payment recipient is not an address',
    )
  }
}

function asAddressString(value: unknown): HexString {
  return assertPayTo(value)
}

function assertNote(note: string): string {
  const trimmed = note.trim()

  if (trimmed.length > MAX_PAYMENT_NOTE_LENGTH) {
    throw new PaymentError(`a payment note cannot exceed ${MAX_PAYMENT_NOTE_LENGTH} characters`)
  }

  return trimmed
}

function asNote(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new PaymentError('a payment note must be text')

  return assertNote(value)
}

function asTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new PaymentError(`${label} must be an ISO-8601 timestamp`)
  }

  return value
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new PaymentError('a payment payload must be JSON')
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PaymentError(`a ${label} must be an object`)
  }

  return value as Record<string, unknown>
}
