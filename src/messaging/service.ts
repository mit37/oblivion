/**
 * Direct messages over any transport.
 *
 * The service owns exactly three things: which conversations this identity
 * watches, what leaves (sealed + signed), and what arrives (opened + verified).
 * Storage is not its business — the caller decides where a message is kept, so
 * the vault stays the single place that holds plaintext at rest.
 */
import type { HexString } from '../crypto/keys'
import { decodePayload, encodePayload, openMessage, sealMessage } from './envelope'
import { MessagingError, NotWatchingError } from './errors'
import { contentTopicFor, conversationIdFor } from './identity'
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
  readonly body: string
  readonly sentAt: string
}

export interface SentMessage extends InboundMessage {
  readonly direction: 'outbound'
}

export interface ReceivedMessage extends InboundMessage {
  readonly direction: 'inbound'
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
    if (!this.started) {
      throw new MessagingError('transport-not-started', 'start the messaging service first')
    }

    const text = assertBody(body)
    const conversationId = conversationIdFor(this.identity.publicKey, contactPublicKey)

    if (!this.watched.has(conversationId)) {
      throw new NotWatchingError()
    }

    const sentAt = this.now().toISOString()

    const payload = await sealMessage({
      plaintext: text,
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
      body: text,
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
      body: assertBody(opened.plaintext),
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
