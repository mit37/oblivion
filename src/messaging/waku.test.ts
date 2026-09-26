import { describe, expect, it, vi } from 'vitest'

import { MessagingError } from './errors'
import { WakuTransport, type WakuSdkLike } from './waku'

const TOPIC = '/oblivion/1/0123456789abcdef0123456789abcdef/proto'

interface FakeSdkOptions {
  readonly peerTimeout?: boolean
  readonly subscribeAccepts?: boolean
  readonly lightPushFailures?: number
  readonly missingFilter?: boolean
  readonly missingLightPush?: boolean
  readonly stopFails?: boolean
}

function fakeSdk(options: FakeSdkOptions = {}) {
  const sent: Array<{ topic: string; payload: Uint8Array }> = []
  const subscribed: Array<{ topic: string; callback: (message: { payload: Uint8Array }) => void }> =
    []
  const events: string[] = []

  const sdk: WakuSdkLike = {
    async createLightNode() {
      events.push('createLightNode')

      return {
        async start() {
          events.push('start')
        },
        async stop() {
          events.push('stop')
          if (options.stopFails) throw new Error('stop failed')
        },
        async waitForPeers(_protocols, timeoutMs) {
          events.push(`waitForPeers:${timeoutMs}`)
          if (options.peerTimeout) throw new Error('no peers')
        },
        lightPush: options.missingLightPush
          ? undefined
          : {
              async send(encoder, message) {
                sent.push({ topic: encoder.contentTopic, payload: message.payload })
                return {
                  failures: Array.from({ length: options.lightPushFailures ?? 0 }, () => ({})),
                }
              },
            },
        filter: options.missingFilter
          ? undefined
          : {
              async subscribe(decoder, callback) {
                subscribed.push({ topic: decoder.contentTopic, callback })
                return options.subscribeAccepts ?? true
              },
              async unsubscribe() {
                return true
              },
            },
      }
    },
    createEncoder: ({ contentTopic }) => ({ contentTopic }),
    createDecoder: ({ contentTopic }) => ({ contentTopic }),
  }

  return { sdk, sent, subscribed, events }
}

function transportWith(sdk: WakuSdkLike, options = {}) {
  return new WakuTransport({ loadSdk: async () => sdk, peerTimeoutMs: 500, ...options })
}

describe('WakuTransport', () => {
  it('starts a light node, waits for peers and stops it', async () => {
    const fake = fakeSdk()
    const transport = transportWith(fake.sdk)

    await transport.start()
    expect(fake.events).toEqual(['createLightNode', 'start', 'waitForPeers:500'])
    expect(transport.isStarted).toBe(true)

    await transport.stop()
    expect(fake.events).toContain('stop')
    expect(transport.isStarted).toBe(false)
  })

  it('publishes to the content topic', async () => {
    const fake = fakeSdk()
    const transport = transportWith(fake.sdk)
    await transport.start()

    await transport.publish(TOPIC, new Uint8Array([1, 2, 3]))

    expect(fake.sent).toEqual([{ topic: TOPIC, payload: new Uint8Array([1, 2, 3]) }])
  })

  it('hands received bytes to the handler, with the topic', async () => {
    const fake = fakeSdk()
    const transport = transportWith(fake.sdk)
    await transport.start()

    const handler = vi.fn()
    await transport.subscribe(TOPIC, handler)

    fake.subscribed[0]?.callback({ payload: new Uint8Array([9]) })
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith({ topic: TOPIC, bytes: new Uint8Array([9]) })
    })
  })

  it('refuses to do anything before it is started', async () => {
    const transport = transportWith(fakeSdk().sdk)

    await expect(transport.publish(TOPIC, new Uint8Array())).rejects.toThrow(/start the Waku node/)
    await expect(transport.subscribe(TOPIC, vi.fn())).rejects.toThrow(MessagingError)
  })

  it('unsubscribes when the caller stops listening', async () => {
    const fake = fakeSdk()
    const transport = transportWith(fake.sdk)
    await transport.start()

    const unsubscribe = await transport.subscribe(TOPIC, vi.fn())
    unsubscribe()

    await transport.stop()
    expect(fake.events).toContain('stop')
  })

  it('reports a node that never found a peer, and does not keep it', async () => {
    const fake = fakeSdk({ peerTimeout: true })
    const transport = transportWith(fake.sdk)

    await expect(transport.start()).rejects.toThrow(/no Waku peer answered/)
    expect(fake.events).toContain('stop')
    expect(transport.isStarted).toBe(false)
  })

  it('reports a filter the node refuses', async () => {
    const fake = fakeSdk({ subscribeAccepts: false })
    const transport = transportWith(fake.sdk)
    await transport.start()

    await expect(transport.subscribe(TOPIC, vi.fn())).rejects.toThrow(/refused a filter/)
  })

  it('reports a light push that no peer accepted', async () => {
    const fake = fakeSdk({ lightPushFailures: 1 })
    const transport = transportWith(fake.sdk)
    await transport.start()

    await expect(transport.publish(TOPIC, new Uint8Array([1]))).rejects.toThrow(
      /no Waku peer accepted/,
    )
  })

  it('reports a node without the protocols it needs', async () => {
    const noFilter = fakeSdk({ missingFilter: true })
    const transport = transportWith(noFilter.sdk)
    await transport.start()
    await expect(transport.subscribe(TOPIC, vi.fn())).rejects.toThrow(/no Filter protocol/)

    const noLightPush = fakeSdk({ missingLightPush: true })
    const other = transportWith(noLightPush.sdk)
    await other.start()
    await expect(other.publish(TOPIC, new Uint8Array())).rejects.toThrow(/no LightPush protocol/)
  })

  it('survives a node that fails to stop', async () => {
    const fake = fakeSdk({ stopFails: true })
    const transport = transportWith(fake.sdk)
    await transport.start()

    await expect(transport.stop()).resolves.toBeUndefined()
  })

  it('reports a SDK that cannot be loaded', async () => {
    const transport = new WakuTransport({
      loadSdk: async () => {
        throw new Error('module not found')
      },
    })

    await expect(transport.start()).rejects.toThrow(/Waku SDK could not be loaded/)
  })
})
