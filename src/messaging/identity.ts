/**
 * Contacts and conversations.
 *
 * A contact is identified by the `oblivion1…` string their app shows (or by the
 * compressed public key inside it). A conversation id is derived from *both*
 * public keys, sorted, so either side computes the same id without being told
 * it — and nobody can invent a conversation id that collides with another pair.
 */
import { sha256 } from '@noble/hashes/sha2.js'

import { bytesToHex, utf8ToBytes } from '../crypto/encoding'
import {
  decodeIdentity,
  encodeIdentity,
  publicKeyFingerprint,
  type HexString,
} from '../crypto/keys'
import { InvalidIdentityError } from './errors'

/**
 * Content topic for a conversation: `/oblivion/1/<conversation id>/proto`.
 *
 * The PRD writes this as `/oblivion/1/dm/<conversation id>/proto`. Waku's
 * autosharding validation (RFC 51, `ensureValidContentTopic`) allows four
 * fields — application, version, topic name, encoding — with an optional
 * generation prefix, and reads the second field as the generation, so the extra
 * `/dm/` segment is rejected outright. The conversation id is the name field
 * here instead, which keeps one topic per pair and one pair per topic. The
 * deviation is recorded in docs/PLAN.md.
 */
export const CONTENT_TOPIC_PREFIX = '/oblivion/1'

export interface ContactIdentity {
  /** The string a contact shares: `oblivion1…`. */
  readonly identity: string
  /** SEC1-compressed secp256k1 messaging public key. */
  readonly publicKey: HexString
  readonly fingerprint: string
}

/** Parses whatever a contact pasted: an `oblivion1…` string or a raw public key. */
export async function parseContactIdentity(value: string): Promise<ContactIdentity> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidIdentityError('a contact identity is a non-empty string')
  }

  const trimmed = value.trim()

  // Both forms are accepted because a contact may paste the key itself out of a
  // QR reader that only kept the payload.
  if (/^0x[0-9a-fA-F]{66}$/.test(trimmed)) {
    const publicKey = trimmed.toLowerCase() as HexString

    try {
      return {
        identity: await encodeIdentity(publicKey),
        publicKey,
        fingerprint: publicKeyFingerprint(publicKey),
      }
    } catch (cause) {
      throw new InvalidIdentityError(
        cause instanceof Error
          ? `not a contact identity: ${cause.message}`
          : 'not a contact identity',
      )
    }
  }

  try {
    const publicKey = await decodeIdentity(trimmed)
    return { identity: trimmed, publicKey, fingerprint: publicKeyFingerprint(publicKey) }
  } catch (cause) {
    throw new InvalidIdentityError(
      cause instanceof Error
        ? `not a contact identity: ${cause.message}`
        : 'not a contact identity',
    )
  }
}

/** Stable, human-checkable id for the pair of keys. Same on both sides. */
export function conversationIdFor(left: HexString, right: HexString): string {
  const [first, second] = [left.toLowerCase(), right.toLowerCase()].sort()
  const digest = bytesToHex(sha256(utf8ToBytes(`${first}:${second}`)))
  return digest.slice(0, 32)
}

/** `content topic` string the transport publishes to for this conversation. */
export function contentTopicFor(conversationId: string): string {
  assertConversationId(conversationId)
  return `${CONTENT_TOPIC_PREFIX}/${conversationId}/proto`
}

export function assertConversationId(value: string): string {
  if (!/^[0-9a-f]{32}$/.test(value)) {
    throw new InvalidIdentityError('conversation id must be 32 hex characters')
  }

  return value
}

/** `oblivion:dm/<conversation id>` — what the vault stores and the UI shows. */
export function conversationKey(conversationId: string): string {
  return `oblivion:dm/${assertConversationId(conversationId)}`
}
