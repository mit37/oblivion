/**
 * Direct messages over any transport.
 *
 * The service owns exactly three things: which conversations this identity
 * watches, what leaves (sealed + signed), and what arrives (opened + verified).
 * Storage is not its business — the caller decides where a message is kept, so
 * the vault stays the single place that holds plaintext at rest.
 */
import type { HexString } from '../crypto/keys'
import {
  decodePayload,
  encodePayload,
  openMessage,
  sealMessage,
  type MessageKind,
} from './envelope'
import { MessagingError, NotWatchingError } from './errors'
import { contentTopicFor, conversationIdFor } from './identity'
import {
  createPaymentReceipt,
  createPaymentRequest,
  decodePaymentReceiptBody,
  decodePaymentRequestBody,
  encodePaymentReceiptBody,
  encodePaymentRequestBody,
  type PaymentReceipt,
  type PaymentRequest,
  type PaymentRequestDraft,
} from './payments'
import type { MessageHandler, MessageTransport } from './transport'

/** Longest body a single message may carry (characters, not bytes). */
export const MAX_MESSAGE_LENGTH = 4_000

export interface MessagingKeypair {
  readonly privateKey: HexString
  readonly publicKey: HexString
}

export interface InboundMessage {
  readonly conversationId: string
  readonly senderPublicKey: HexString
  /** `text` carries words; the payment kinds carry JSON (see `payments.ts`). */
  readonly kind: MessageKind
  readonly body: string
  readonly sentAt: string
}

export interface SentMessage extends InboundMessage {
  readonly direction: 'outbound'
}

export interface ReceivedMessage extends InboundMessage {
  readonly direction: 'inbound'
}

/** A request this identity just sent, already parsed for the caller to store. */
export interface SentPaymentRequest extends SentMessage {
  readonly kind: 'payment-request'
  readonly request: PaymentRequest
}

/** A receipt this identity just sent, already parsed for the caller to store. */
export interface SentPaymentReceipt extends SentMessage {
  readonly kind: 'payment-receipt'
  readonly receipt: PaymentReceipt
}

export interface MessagingServiceOptions {
  readonly transport: MessageTransport
  readonly identity: MessagingKeypair
  /** Called for every message that decrypts and verifies. */
  readonly onMessage?: (message: ReceivedMessage) => void | Promise<void>
  /** Called for messages that arrive but cannot be used. */
  readonly onRejected?: (error: Error, topic: string) => void
  readonly now?: () => Date
}

interface Watched {
  readonly conversationId: string
  readonly topic: string
  readonly contactPublicKey: HexString
  readonly unsubscribe: () => void
}

export class MessagingService {
  private readonly transport: MessageTransport
  private readonly identity: MessagingKeypair
  private readonly onMessage: MessagingServiceOptions['onMessage']
  private readonly onRejected: MessagingServiceOptions['onRejected']
  private readonly now: () => Date
  private readonly watched = new Map<string, Watched>()
  private started = false

  constructor(options: MessagingServiceOptions) {
    this.transport = options.transport
    this.identity = options.identity
    this.onMessage = options.onMessage
    this.onRejected = options.onRejected
    this.now = options.now ?? (() => new Date())
  }

  get identityPublicKey(): HexString {
    return this.identity.publicKey
  }

  get transportName(): string {
    return this.transport.name
  }

  get isStarted(): boolean {
    return this.started
  }

  /** Conversation ids this service is listening on, in the order they were added. */
  get conversations(): readonly string[] {
    return [...this.watched.keys()]
  }

  async start(): Promise<void> {
    if (this.started) return

    await this.transport.start()
    this.started = true
  }

  async stop(): Promise<void> {
    if (!this.started) return

    await this.unwatchAll()
    await this.transport.stop()
    this.started = false
  }

  /**
   * Starts listening to a contact. Idempotent, and the conversation id is
   * derived from both public keys, so the other side arrives at the same topic
   * without being told what it is.
   */
  async watch(contactPublicKey: HexString): Promise<string> {
    const conversationId = conversationIdFor(this.identity.publicKey, contactPublicKey)
    const existing = this.watched.get(conversationId)

    if (existing) return conversationId

    if (!this.started) {
      throw new MessagingError('transport-not-started', 'start the messaging service first')
    }

    const topic = contentTopicFor(conversationId)
    const handler: MessageHandler = async (message) => {
      await this.handleInbound(message.topic, message.bytes, contactPublicKey)
    }

    const unsubscribe = await this.transport.subscribe(topic, handler)

    // A second watch for the same key must leave with the first one's closure:
    // the key that owns the topic is fixed here, not taken on trust later.
    this.watched.set(conversationId, {
      conversationId,
      topic,
      contactPublicKey: contactPublicKey.toLowerCase() as HexString,
      unsubscribe,
    })

    return conversationId
  }

  async unwatch(contactPublicKey: HexString): Promise<void> {
    const conversationId = conversationIdFor(this.identity.publicKey, contactPublicKey)
    const entry = this.watched.get(conversationId)

    if (!entry) return

    entry.unsubscribe()
    this.watched.delete(conversationId)
  }

  async unwatchAll(): Promise<void> {
    for (const entry of this.watched.values()) entry.unsubscribe()
    this.watched.clear()
  }

  /**
   * Seals, signs and publishes. Returns the record the caller should store.
   *
   * Sending does *not* subscribe on the caller's behalf: a contact must be
   * watched first, so "stop listening to this person" means what it says.
   */
  async sendText(contactPublicKey: HexString, body: string): Promise<SentMessage> {
    return this.sealAndPublish(contactPublicKey, assertBody(body), 'text')
  }

  /**
   * Asks a contact for ETH. The request is validated here (address, amount,
   * chain) before it is sealed, so a request that could never be paid is never
   * put on the wire.
   */
  async sendPaymentRequest(
    contactPublicKey: HexString,
    draft: PaymentRequestDraft,
  ): Promise<SentPaymentRequest> {
    const request = createPaymentRequest(draft)
    const sent = await this.sealAndPublish(
      contactPublicKey,
      encodePaymentRequestBody(request),
      'payment-request',
    )

    return { ...sent, kind: 'payment-request', request }
  }

  /** Posts the outcome back into the thread — the transaction hash, or a refusal. */
  async sendPaymentReceipt(
    contactPublicKey: HexString,
    input: {
      readonly requestId: string
      readonly status: PaymentReceipt['status']
      readonly txHash?: HexString | null
      readonly settledAt?: string
    },
  ): Promise<SentPaymentReceipt> {
    const receipt = createPaymentReceipt({
      requestId: input.requestId,
      status: input.status,
      txHash: input.txHash ?? null,
      settledAt: input.settledAt ?? this.now().toISOString(),
    })

    const sent = await this.sealAndPublish(
      contactPublicKey,
      encodePaymentReceiptBody(receipt),
      'payment-receipt',
    )

    return { ...sent, kind: 'payment-receipt', receipt }
  }

  /**
   * The one path out: watch check, seal, sign, publish. Every kind leaves the
   * same way, so no kind can skip the check that the contact is being listened
   * to, and none can publish unsealed bytes.
   */
  private async sealAndPublish(
    contactPublicKey: HexString,
    plaintext: string,
    kind: MessageKind,
  ): Promise<SentMessage> {
    if (!this.started) {
      throw new MessagingError('transport-not-started', 'start the messaging service first')
    }

    const conversationId = conversationIdFor(this.identity.publicKey, contactPublicKey)

    if (!this.watched.has(conversationId)) {
      throw new NotWatchingError()
    }

    const sentAt = this.now().toISOString()

    const payload = await sealMessage({
      plaintext,
      kind,
      senderPrivateKey: this.identity.privateKey,
      senderPublicKey: this.identity.publicKey,
      recipientPublicKey: contactPublicKey,
      conversationId,
      sentAt,
    })

    await this.transport.publish(contentTopicFor(conversationId), encodePayload(payload))

    return {
      conversationId,
      senderPublicKey: this.identity.publicKey,
      kind,
      body: plaintext,
      sentAt,
      direction: 'outbound',
    }
  }

  /**
   * Opens a payload that arrived on `topic`, and hands it to `onMessage`.
   * Returns `null` for this identity's own message coming back from the network,
   * which is normal on publish/subscribe transports and is not a failure.
   */
  async receive(
    topic: string,
    bytes: Uint8Array,
    fromPublicKey: HexString,
  ): Promise<ReceivedMessage | null> {
    const conversationId = conversationIdFor(this.identity.publicKey, fromPublicKey)

    if (contentTopicFor(conversationId) !== topic) {
      throw new MessagingError('wrong-conversation', 'this topic does not belong to that contact')
    }

    const payload = decodePayload(bytes)

    if (payload.senderPublicKey.toLowerCase() === this.identity.publicKey.toLowerCase()) {
      return null
    }

    const opened = await openMessage({
      payload,
      recipientPrivateKey: this.identity.privateKey,
      conversationId,
      expectedSenderPublicKey: fromPublicKey.toLowerCase() as HexString,
    })

    const message: ReceivedMessage = {
      conversationId,
      senderPublicKey: opened.senderPublicKey,
      kind: opened.kind,
      // A payment body is checked here as well as at render time: a frame that
      // claims to be a payment but does not parse is rejected, not displayed.
      body: assertBodyForKind(opened.kind, opened.plaintext),
      sentAt: opened.sentAt,
      direction: 'inbound',
    }

    await this.onMessage?.(message)
    return message
  }

  /** Called by the transport for every inbound frame; failures go to `onRejected`. */
  async handleInbound(topic: string, bytes: Uint8Array, fromPublicKey: HexString): Promise<void> {
    try {
      await this.receive(topic, bytes, fromPublicKey)
    } catch (cause) {
      this.onRejected?.(cause instanceof Error ? cause : new Error(String(cause)), topic)
    }
  }
}

export function assertBody(body: string): string {
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new MessagingError('invalid-envelope', 'a message body cannot be empty')
  }

  if (body.length > MAX_MESSAGE_LENGTH) {
    throw new MessagingError(
      'invalid-envelope',
      `a message body cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
    )
  }

  return body
}

/**
 * Checks a body against the kind that was signed for it, and returns it
 * unchanged so the caller can store exactly what arrived. Text is checked for
 * length; a payment payload must validate as JSON with usable fields.
 */
export function assertBodyForKind(kind: MessageKind, plaintext: string): string {
  const body = assertBody(plaintext)

  if (kind === 'payment-request') decodePaymentRequestBody(body)
  if (kind === 'payment-receipt') decodePaymentReceiptBody(body)

  return body
}
