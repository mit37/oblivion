/**
 * The direct-message envelope.
 *
 * One message is sealed to one recipient's messaging public key:
 *
 *  1. a fresh ephemeral secp256k1 keypair per message → ECDH with the recipient
 *     (so a stolen long-term key does not open past messages on its own),
 *  2. HKDF-SHA256 over the shared point, salted with the conversation id, to get
 *     a 32-byte AEAD key,
 *  3. XChaCha20-Poly1305 over the plaintext, with the canonical header as
 *     associated data,
 *  4. a compact secp256k1 signature by the sender over that same header, so the
 *     recipient knows which known contact wrote it instead of trusting a field.
 *
 * The header is authenticated twice — once by the signature, once as AAD — so a
 * message cannot be replayed into another conversation or re-labelled.
 */
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'

import { openText, sealText } from '../crypto/aead'
import { bytesToHex, bytesToUtf8, hexToBytes, isUint8Array, utf8ToBytes } from '../crypto/encoding'
import type { HexString } from '../crypto/keys'
import { signBytes, verifyBytes } from '../crypto/signatures'
import { InvalidEnvelopeError } from './errors'
import { assertConversationId } from './identity'

export const MESSAGE_ENVELOPE_VERSION = 'om1'

/** Domain separation for the HKDF step. */
const KEY_INFO = utf8ToBytes('oblivion/1/dm')

export interface MessagePayload {
  readonly version: string
  readonly conversationId: string
  readonly senderPublicKey: HexString
  /** Ephemeral public key of this one message. */
  readonly ephemeralPublicKey: HexString
  readonly sentAt: string
  /** `oc1.…` sealed text. */
  readonly sealed: string
  readonly signature: HexString
}

export interface SealMessageOptions {
  readonly plaintext: string
  readonly senderPrivateKey: HexString
  readonly senderPublicKey: HexString
  readonly recipientPublicKey: HexString
  readonly conversationId: string
  readonly sentAt: string
  /** Tests only: pin the ephemeral key so the output is reproducible. */
  readonly ephemeralPrivateKey?: HexString
}

export interface OpenMessageOptions {
  readonly payload: unknown
  readonly recipientPrivateKey: HexString
  readonly conversationId: string
  /** When set, the signature must come from this key. */
  readonly expectedSenderPublicKey?: HexString
}

export interface OpenedMessage {
  readonly plaintext: string
  readonly senderPublicKey: HexString
  readonly sentAt: string
  readonly conversationId: string
}

export async function sealMessage(options: SealMessageOptions): Promise<MessagePayload> {
  const conversationId = assertConversationId(options.conversationId)
  const senderPublicKey = assertPublicKey(options.senderPublicKey, 'sender public key')
  const recipientPublicKey = assertPublicKey(options.recipientPublicKey, 'recipient public key')
  const sentAt = assertTimestamp(options.sentAt)

  const ephemeralPrivateKey = options.ephemeralPrivateKey
    ? privateKeyBytes(options.ephemeralPrivateKey)
    : secp256k1.utils.randomSecretKey()

  const ephemeralPublicKey = bytesToHex(secp256k1.getPublicKey(ephemeralPrivateKey, true), {
    prefix: true,
  }) as HexString

  const header = headerBytes({
    conversationId,
    senderPublicKey,
    ephemeralPublicKey,
    sentAt,
  })

  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivateKey, hexToBytes(recipientPublicKey))
  const key = deriveMessageKey(sharedPoint, conversationId)

  const sealed = await sealText(key, options.plaintext, { aad: header })
  const signature = signBytes(options.senderPrivateKey, header) as HexString

  return {
    version: MESSAGE_ENVELOPE_VERSION,
    conversationId,
    senderPublicKey,
    ephemeralPublicKey,
    sentAt,
    sealed,
    signature,
  }
}

/**
 * Opens a payload. The sender is *verified*, not assumed: the signature must be
 * valid for the `senderPublicKey` in the header, and — when the caller knows who
 * it expects to hear from — that key must match.
 */
export async function openMessage(options: OpenMessageOptions): Promise<OpenedMessage> {
  const payload = parseMessagePayload(options.payload)
  const conversationId = assertConversationId(options.conversationId)

  if (payload.conversationId !== conversationId) {
    throw new InvalidEnvelopeError('this message belongs to a different conversation')
  }

  if (
    options.expectedSenderPublicKey &&
    options.expectedSenderPublicKey !== payload.senderPublicKey
  ) {
    throw new InvalidEnvelopeError(
      'the message came from a different key than the subject of this chat',
    )
  }

  const header = headerBytes(payload)

  if (!verifyBytes(payload.senderPublicKey, header, payload.signature)) {
    throw new InvalidEnvelopeError('the message signature does not match its sender key')
  }

  const recipientPrivateKey = privateKeyBytes(options.recipientPrivateKey)
  const sharedPoint = secp256k1.getSharedSecret(
    recipientPrivateKey,
    hexToBytes(payload.ephemeralPublicKey),
  )
  const key = deriveMessageKey(sharedPoint, conversationId)

  const plaintext = await openText(key, payload.sealed, { expectedAad: header })

  return {
    plaintext,
    senderPublicKey: payload.senderPublicKey,
    sentAt: payload.sentAt,
    conversationId,
  }
}

/** Wire form: UTF-8 JSON. JSON, not a packed binary, so the format is inspectable. */
export function encodePayload(payload: MessagePayload): Uint8Array {
  return utf8ToBytes(JSON.stringify(payload))
}

/** Parses the wire form, refusing anything that is not a well-formed envelope. */
export function decodePayload(bytes: Uint8Array): MessagePayload {
  if (!isUint8Array(bytes)) {
    throw new InvalidEnvelopeError('a message arrives as bytes')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(bytesToUtf8(bytes))
  } catch {
    throw new InvalidEnvelopeError('a message must be UTF-8 JSON')
  }

  return parseMessagePayload(parsed)
}

export function parseMessagePayload(value: unknown): MessagePayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidEnvelopeError('a message payload must be an object')
  }

  const record = value as Record<string, unknown>

  if (record.version !== MESSAGE_ENVELOPE_VERSION) {
    throw new InvalidEnvelopeError(`unsupported message version "${String(record.version)}"`)
  }

  const conversationId = assertString(record.conversationId, 'conversationId')

  // Checked here rather than through the identity helper so that a malformed
  // wire payload reports as an envelope problem, not an identity one.
  if (!/^[0-9a-f]{32}$/.test(conversationId)) {
    throw new InvalidEnvelopeError('conversationId must be 32 hex characters')
  }

  const sealed = assertString(record.sealed, 'sealed')
  if (!sealed.startsWith('oc1.')) {
    throw new InvalidEnvelopeError('the sealed body is not an oc1 envelope')
  }

  const signature = assertString(record.signature, 'signature')
  if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) {
    throw new InvalidEnvelopeError('signature must be 64 bytes of hex')
  }

  return {
    version: MESSAGE_ENVELOPE_VERSION,
    conversationId,
    senderPublicKey: assertPublicKey(record.senderPublicKey, 'senderPublicKey'),
    ephemeralPublicKey: assertPublicKey(record.ephemeralPublicKey, 'ephemeralPublicKey'),
    sentAt: assertTimestamp(assertString(record.sentAt, 'sentAt')),
    sealed,
    signature: signature.toLowerCase() as HexString,
  }
}

/** The bytes that are both signed and used as associated data. */
export function headerBytes(header: {
  readonly conversationId: string
  readonly senderPublicKey: string
  readonly ephemeralPublicKey: string
  readonly sentAt: string
}): Uint8Array {
  return utf8ToBytes(
    [
      MESSAGE_ENVELOPE_VERSION,
      header.conversationId,
      header.senderPublicKey.toLowerCase(),
      header.ephemeralPublicKey.toLowerCase(),
      header.sentAt,
    ].join('\n'),
  )
}

export function deriveMessageKey(sharedPoint: Uint8Array, conversationId: string): Uint8Array {
  return hkdf(sha256, sharedPoint, utf8ToBytes(conversationId), KEY_INFO, 32)
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidEnvelopeError(`${label} must be a non-empty string`)
  }

  return value
}

function assertPublicKey(value: unknown, label: string): HexString {
  const text = assertString(value, label)

  if (!/^0x[0-9a-fA-F]{66}$/.test(text)) {
    throw new InvalidEnvelopeError(`${label} must be a 33-byte compressed public key`)
  }

  const bytes = hexToBytes(text)

  if (!secp256k1.utils.isValidPublicKey(bytes)) {
    throw new InvalidEnvelopeError(`${label} is not a valid secp256k1 point`)
  }

  return text.toLowerCase() as HexString
}

function assertTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidEnvelopeError('sentAt must be an ISO-8601 timestamp')
  }

  return value
}

function privateKeyBytes(value: string): Uint8Array {
  const bytes = hexToBytes(value)

  if (bytes.length !== 32 || !secp256k1.utils.isValidSecretKey(bytes)) {
    throw new InvalidEnvelopeError('private key must be a valid 32-byte secp256k1 scalar')
  }

  return bytes
}
