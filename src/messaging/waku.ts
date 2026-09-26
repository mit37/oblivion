/**
 * The live transport: a Waku light node (LightPush to send, Filter to receive).
 *
 * The SDK is imported lazily, so nothing here is in the main bundle and no test
 * or CI run ever loads it. The narrow `WakuSdkLike` shape below is what the
 * adapter actually uses, which also means the adapter's own logic can be tested
 * against a fake SDK without touching libp2p.
 *
 * Encryption is *not* the SDK's job here: messages are already sealed by
 * `envelope.ts` before they reach this file, so the network only ever carries
 * opaque bytes. See docs/SECURITY.md.
 */
import { MessagingError } from './errors'
import type { MessageHandler, MessageTransport } from './transport'

/**
 * The SDK's own `Protocols` values (`{ LightPush: 'lightpush', Filter: 'filter' }`),
 * which is what `waitForPeers` matches on — not the `/vac/…` multiaddrs.
 */
export const WAKU_LIGHTPUSH_PROTOCOL = 'lightpush'
export const WAKU_FILTER_PROTOCOL = 'filter'

/** How long to wait for a peer that speaks LightPush and Filter. */
export const DEFAULT_PEER_TIMEOUT_MS = 30_000

export interface WakuMessageLike {
  readonly payload: Uint8Array
}

export interface WakuEncoderLike {
  readonly contentTopic: string
}

export interface WakuDecoderLike {
  readonly contentTopic: string
}

export interface WakuNodeLike {
  start(): Promise<void>
  stop(): Promise<void>
  waitForPeers(protocols?: readonly string[], timeoutMs?: number): Promise<void>
  /**
   * The node's own factory fills in the routing info (pubsub topic and shard)
   * that a bare `createDecoder` from the SDK leaves undefined, which the Filter
   * subscription then trips over.
   */
  readonly createEncoder?: (params: { contentTopic: string }) => WakuEncoderLike
  readonly createDecoder?: (params: { contentTopic: string }) => WakuDecoderLike
  readonly lightPush?: {
    send(encoder: WakuEncoderLike, message: WakuMessageLike): Promise<unknown>
  }
  readonly filter?: {
    subscribe(
      decoder: WakuDecoderLike,
      callback: (message: WakuMessageLike) => void,
    ): Promise<boolean>
    unsubscribe(decoder: WakuDecoderLike): Promise<boolean>
  }
}

export interface WakuSdkLike {
  createLightNode(options?: {
    defaultBootstrap?: boolean
    bootstrapPeers?: readonly string[]
  }): Promise<WakuNodeLike>
  createEncoder(params: { contentTopic: string }): WakuEncoderLike
  createDecoder(params: { contentTopic: string }): WakuDecoderLike
}

export interface WakuTransportOptions {
  /** Extra bootstrap peers; the SDK's default bootstrap is used when empty. */
  readonly bootstrapPeers?: readonly string[]
  readonly peerTimeoutMs?: number
  /** Test seam: replace the lazily imported SDK. */
  readonly loadSdk?: () => Promise<WakuSdkLike>
}

async function loadWakuSdk(): Promise<WakuSdkLike> {
  return (await import('@waku/sdk')) as unknown as WakuSdkLike
}

export class WakuTransport implements MessageTransport {
  readonly name = 'waku'

  private readonly options: WakuTransportOptions
  private readonly subscriptions = new Map<string, { decoder: WakuDecoderLike }>()
  private sdk: WakuSdkLike | null = null
  private node: WakuNodeLike | null = null

  constructor(options: WakuTransportOptions = {}) {
    this.options = options
  }

  get isStarted(): boolean {
    return this.node !== null
  }

  async start(): Promise<void> {
    if (this.node) return

    let sdk: WakuSdkLike

    try {
      sdk = await (this.options.loadSdk ?? loadWakuSdk)()
    } catch (cause) {
      throw new MessagingError(
        'transport-failed',
        cause instanceof Error
          ? `the Waku SDK could not be loaded: ${cause.message}`
          : 'the Waku SDK could not be loaded',
      )
    }

    this.sdk = sdk

    const peers = [...(this.options.bootstrapPeers ?? [])]
    const node = await sdk.createLightNode(
      peers.length > 0
        ? { defaultBootstrap: false, bootstrapPeers: peers }
        : { defaultBootstrap: true },
    )

    try {
      await node.start()
      await node.waitForPeers(
        [WAKU_LIGHTPUSH_PROTOCOL, WAKU_FILTER_PROTOCOL],
        this.options.peerTimeoutMs ?? DEFAULT_PEER_TIMEOUT_MS,
      )
    } catch (cause) {
      // A node that never found a peer is useless to the user, and saying so is
      // better than a UI that silently never receives anything.
      await node.stop().catch(() => undefined)

      throw new MessagingError(
        'transport-failed',
        cause instanceof Error
          ? `no Waku peer answered: ${cause.message}`
          : 'no Waku peer answered',
      )
    }

    this.node = node
  }

  async stop(): Promise<void> {
    for (const topic of [...this.subscriptions.keys()]) await this.unsubscribeTopic(topic)

    await this.node?.stop().catch(() => undefined)
    this.node = null
    this.sdk = null
  }

  async subscribe(topic: string, handler: MessageHandler): Promise<() => void> {
    const node = this.node
    const sdk = this.sdk

    if (!node || !sdk) {
      throw new MessagingError('transport-not-started', 'start the Waku node first')
    }

    // Called on the node (not detached from it): the method needs its own `this`.
    const decoder = node.createDecoder
      ? node.createDecoder({ contentTopic: topic })
      : sdk.createDecoder({ contentTopic: topic })
    const filter = node.filter

    if (!filter) {
      throw new MessagingError('transport-failed', 'this node has no Filter protocol')
    }

    const accepted = await filter.subscribe(decoder, (message) => {
      void handler({ topic, bytes: message.payload })
    })

    if (!accepted) {
      throw new MessagingError('transport-failed', `the node refused a filter for ${topic}`)
    }

    this.subscriptions.set(topic, { decoder })

    return () => {
      this.subscriptions.delete(topic)
      void filter.unsubscribe(decoder).catch(() => undefined)
    }
  }

  async publish(topic: string, bytes: Uint8Array): Promise<void> {
    const node = this.node
    const sdk = this.sdk

    if (!node || !sdk) {
      throw new MessagingError('transport-not-started', 'start the Waku node first')
    }

    if (!node.lightPush) {
      throw new MessagingError('transport-failed', 'this node has no LightPush protocol')
    }

    const encoder = node.createEncoder
      ? node.createEncoder({ contentTopic: topic })
      : sdk.createEncoder({ contentTopic: topic })
    const result = (await node.lightPush.send(encoder, { payload: bytes })) as
      { failures?: readonly unknown[] } | undefined

    if (result && Array.isArray(result.failures) && result.failures.length > 0) {
      throw new MessagingError('transport-failed', 'no Waku peer accepted the message')
    }
  }

  private async unsubscribeTopic(topic: string): Promise<void> {
    const entry = this.subscriptions.get(topic)
    this.subscriptions.delete(topic)

    if (entry && this.node?.filter) {
      await this.node.filter.unsubscribe(entry.decoder).catch(() => undefined)
    }
  }
}

export async function createWakuTransport(
  options: WakuTransportOptions = {},
): Promise<MessageTransport> {
  return new WakuTransport(options)
}
