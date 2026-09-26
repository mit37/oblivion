import { MessagingError } from './errors'
import type { MessageHandler, MessageTransport, TransportMessage } from './transport'

/**
 * A network that lives inside one JS process.
 *
 * Used by the tests (two "peers" on one network) and by the app's local demo
 * mode, so the whole messaging flow can be driven with no outbound network at
 * all. It models delivery honestly: subscribers only receive what they asked
 * for, delivery awaits every handler, and a handler that throws is recorded
 * rather than allowed to break the others.
 */
export class InMemoryNetwork {
  private readonly subscribers = new Map<string, Set<MessageHandler>>()
  private readonly failures: Error[] = []
  private online = true
  private publishedCount = 0
  private deliveredCount = 0

  createTransport(name = 'memory'): MessageTransport {
    return new InMemoryTransport(this, name)
  }

  get published(): number {
    return this.publishedCount
  }

  get delivered(): number {
    return this.deliveredCount
  }

  /** Delivery errors are collected here, so tests can assert nothing failed. */
  get errors(): readonly Error[] {
    return this.failures
  }

  setOnline(online: boolean): void {
    this.online = online
  }

  subscribe(topic: string, handler: MessageHandler): () => void {
    const handlers = this.subscribers.get(topic) ?? new Set<MessageHandler>()
    handlers.add(handler)
    this.subscribers.set(topic, handlers)

    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.subscribers.delete(topic)
    }
  }

  subscriberCount(topic: string): number {
    return this.subscribers.get(topic)?.size ?? 0
  }

  async publish(topic: string, bytes: Uint8Array): Promise<void> {
    if (!this.online) {
      throw new MessagingError('transport-failed', 'the network is offline')
    }

    this.publishedCount += 1
    const handlers = [...(this.subscribers.get(topic) ?? [])]

    for (const handler of handlers) {
      this.deliveredCount += 1

      try {
        await handler({ topic, bytes } satisfies TransportMessage)
      } catch (cause) {
        this.failures.push(cause instanceof Error ? cause : new Error(String(cause)))
      }
    }
  }
}

class InMemoryTransport implements MessageTransport {
  readonly name: string
  private readonly unsubscribe: Array<() => void> = []
  private started = false

  constructor(
    private readonly network: InMemoryNetwork,
    name: string,
  ) {
    this.name = name
  }

  async start(): Promise<void> {
    this.started = true
  }

  async stop(): Promise<void> {
    this.started = false

    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe()
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<() => void> {
    const unsubscribe = this.network.subscribe(topic, handler)
    this.unsubscribe.push(unsubscribe)
    return unsubscribe
  }

  async publish(topic: string, bytes: Uint8Array): Promise<void> {
    if (!this.started) {
      throw new MessagingError('transport-not-started', 'this transport has not been started')
    }

    await this.network.publish(topic, bytes)
  }
}
