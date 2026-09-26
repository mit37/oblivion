/**
 * The vault document: everything the app knows that must stay encrypted at
 * rest. It is versioned, and `migrateDocument` upgrades (and validates) any
 * older or partially-populated shape, so later milestones can add fields
 * without stranding an existing vault.
 */
import { MalformedPayloadError } from '../crypto/errors'
import { KDF_PROFILES, type KdfProfileName } from '../crypto/kdf'
import {
  isValidMnemonic,
  normalizeMnemonic,
  type HexString,
  type MnemonicWordCount,
} from '../crypto/keys'
import type { TokenInfo } from '../wallet/types'

/**
 * 1 → identity, settings, contacts, messages, payments.
 * 2 → adds the watched ERC-20 token list.
 */
export const VAULT_SCHEMA_VERSION = 2

/** Auto-lock choices offered in Settings, in minutes. */
export const AUTO_LOCK_CHOICES_MINUTES = [1, 5, 15, 60] as const
export const DEFAULT_AUTO_LOCK_MINUTES = 15

export interface VaultIdentity {
  /** The BIP-39 mnemonic every key in the vault is derived from. */
  readonly mnemonic: string
  readonly wordCount: MnemonicWordCount
  readonly createdAt: string
}

export interface VaultSettings {
  readonly kdfProfile: KdfProfileName
  readonly autoLockMinutes: number
  readonly addressIndex: number
}

export interface ContactRecord {
  readonly id: string
  readonly label: string
  /** `oblivion1…` identity string that was exchanged. */
  readonly identity: string
  /** SEC1-compressed secp256k1 public key. */
  readonly publicKey: HexString
  readonly addedAt: string
}

export type MessageKind = 'text' | 'payment-request' | 'payment-receipt'

export interface MessageRecord {
  readonly id: string
  readonly conversationId: string
  readonly direction: 'inbound' | 'outbound'
  readonly body: string
  readonly sentAt: string
  readonly kind: MessageKind
  readonly paymentId?: string
}

export interface PaymentRecord {
  readonly id: string
  readonly conversationId: string
  readonly role: 'requested' | 'received'
  readonly amountWei: string
  readonly from: HexString
  readonly to: HexString
  readonly status: 'requested' | 'paid' | 'declined'
  readonly requestedAt: string
  readonly paidAt?: string
  readonly txHash?: HexString
}

export interface VaultDocument {
  readonly schemaVersion: number
  readonly identity: VaultIdentity
  readonly settings: VaultSettings
  readonly contacts: readonly ContactRecord[]
  readonly messages: readonly MessageRecord[]
  readonly payments: readonly PaymentRecord[]
  readonly tokens: readonly TokenInfo[]
}

export interface CreateDocumentOptions {
  readonly mnemonic: string
  readonly wordCount: MnemonicWordCount
  readonly createdAt: string
  readonly kdfProfile: KdfProfileName
  readonly autoLockMinutes?: number
  readonly addressIndex?: number
}

export function createEmptyDocument(options: CreateDocumentOptions): VaultDocument {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    identity: {
      mnemonic: normalizeMnemonic(options.mnemonic),
      wordCount: options.wordCount,
      createdAt: options.createdAt,
    },
    settings: {
      kdfProfile: options.kdfProfile,
      autoLockMinutes: clampAutoLockMinutes(options.autoLockMinutes),
      addressIndex: clampAddressIndex(options.addressIndex),
    },
    contacts: [],
    messages: [],
    payments: [],
    tokens: [],
  }
}

/**
 * Validates a decrypted payload and fills in anything an older version of the
 * app did not write. Throws `MalformedPayloadError` when the core identity is
 * missing or unusable — that means the vault is not ours, and guessing would be
 * worse than failing.
 */
export function migrateDocument(input: unknown): VaultDocument {
  const record = asRecord(input, 'vault document')

  const identity = asRecord(record.identity, 'vault identity')
  const mnemonic = normalizeMnemonic(asString(identity.mnemonic, 'identity.mnemonic'))

  if (!isValidMnemonic(mnemonic)) {
    throw new MalformedPayloadError('vault identity does not contain a valid BIP-39 mnemonic')
  }

  const wordCount = mnemonic.split(' ').length === 24 ? 24 : 12
  const settings = isRecord(record.settings) ? record.settings : {}

  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    identity: {
      mnemonic,
      wordCount,
      createdAt: asIsoString(identity.createdAt, 'identity.createdAt'),
    },
    settings: {
      kdfProfile: asKdfProfile(settings.kdfProfile),
      autoLockMinutes: clampAutoLockMinutes(asNumberOrUndefined(settings.autoLockMinutes)),
      addressIndex: clampAddressIndex(asNumberOrUndefined(settings.addressIndex)),
    },
    contacts: asArray(record.contacts, 'contacts').map(asContactRecord),
    messages: asArray(record.messages, 'messages').map(asMessageRecord),
    payments: asArray(record.payments, 'payments').map(asPaymentRecord),
    tokens: asArray(record.tokens, 'tokens').map(asTokenInfo),
  }
}

function asTokenInfo(value: unknown): TokenInfo {
  const record = asRecord(value, 'token')
  const address = asString(record.address, 'token.address')

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new MalformedPayloadError('token.address must be a 20-byte hex address')
  }

  const decimals = asNumberOrUndefined(record.decimals) ?? 18

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new MalformedPayloadError('token.decimals must be an integer between 0 and 36')
  }

  return {
    address: address as HexString,
    name: asString(record.name, 'token.name'),
    symbol: asString(record.symbol, 'token.symbol'),
    decimals,
  }
}

export function clampAutoLockMinutes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_AUTO_LOCK_MINUTES
  const rounded = Math.round(value)
  if (AUTO_LOCK_CHOICES_MINUTES.includes(rounded as (typeof AUTO_LOCK_CHOICES_MINUTES)[number])) {
    return rounded
  }
  return DEFAULT_AUTO_LOCK_MINUTES
}

export function clampAddressIndex(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0 || value > 2 ** 31 - 1) {
    return 0
  }
  return value
}

function asContactRecord(value: unknown): ContactRecord {
  const record = asRecord(value, 'contact')
  return {
    id: asString(record.id, 'contact.id'),
    label: asString(record.label, 'contact.label'),
    identity: asString(record.identity, 'contact.identity'),
    publicKey: asString(record.publicKey, 'contact.publicKey') as HexString,
    addedAt: asIsoString(record.addedAt, 'contact.addedAt'),
  }
}

function asMessageRecord(value: unknown): MessageRecord {
  const record = asRecord(value, 'message')
  const kind = asString(record.kind, 'message.kind')

  if (kind !== 'text' && kind !== 'payment-request' && kind !== 'payment-receipt') {
    throw new MalformedPayloadError(`unknown message kind "${kind}"`)
  }

  const direction = asString(record.direction, 'message.direction')
  if (direction !== 'inbound' && direction !== 'outbound') {
    throw new MalformedPayloadError(`unknown message direction "${direction}"`)
  }

  return {
    id: asString(record.id, 'message.id'),
    conversationId: asString(record.conversationId, 'message.conversationId'),
    direction,
    body: asString(record.body, 'message.body'),
    sentAt: asIsoString(record.sentAt, 'message.sentAt'),
    kind,
    ...(typeof record.paymentId === 'string' ? { paymentId: record.paymentId } : {}),
  }
}

function asPaymentRecord(value: unknown): PaymentRecord {
  const record = asRecord(value, 'payment')
  const role = asString(record.role, 'payment.role')
  const status = asString(record.status, 'payment.status')

  if (role !== 'requested' && role !== 'received') {
    throw new MalformedPayloadError(`unknown payment role "${role}"`)
  }

  if (status !== 'requested' && status !== 'paid' && status !== 'declined') {
    throw new MalformedPayloadError(`unknown payment status "${status}"`)
  }

  return {
    id: asString(record.id, 'payment.id'),
    conversationId: asString(record.conversationId, 'payment.conversationId'),
    role,
    amountWei: asString(record.amountWei, 'payment.amountWei'),
    from: asString(record.from, 'payment.from') as HexString,
    to: asString(record.to, 'payment.to') as HexString,
    status,
    requestedAt: asIsoString(record.requestedAt, 'payment.requestedAt'),
    ...(typeof record.paidAt === 'string' ? { paidAt: record.paidAt } : {}),
    ...(typeof record.txHash === 'string' ? { txHash: record.txHash as HexString } : {}),
  }
}

function asKdfProfile(value: unknown): KdfProfileName {
  if (value === 'interactive' || value === 'sensitive') return value
  return 'interactive'
}

function asArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new MalformedPayloadError(`${label} must be an array`)
  }
  return value
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new MalformedPayloadError(`${label} must be an object`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedPayloadError(`${label} must be a non-empty string`)
  }
  return value
}

function asIsoString(value: unknown, label: string): string {
  const text = asString(value, label)
  if (Number.isNaN(Date.parse(text))) {
    throw new MalformedPayloadError(`${label} must be an ISO-8601 timestamp`)
  }
  return text
}

function asNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** True when the document came from the current schema version. */
export function isCurrentSchema(document: VaultDocument): boolean {
  return document.schemaVersion === VAULT_SCHEMA_VERSION
}

/** Convenience for UI copy: the profile name is always one we support. */
export function isSupportedProfile(name: KdfProfileName): boolean {
  return name in KDF_PROFILES
}
