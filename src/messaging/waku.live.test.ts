/**
 * The live path, opt-in.
 *
 * Skipped unless `WAKU_LIVE=1`, because it needs outbound network access to the
 * public Waku network and takes as long as peer discovery takes. CI never sets
 * the flag, so CI stays hermetic; the result of running it locally is recorded
 * in `docs/PLAN.md`.
 *
 * Run it with:
 *   WAKU_LIVE=1 npx vitest run --environment node src/messaging/waku.live.test.ts
 */
import { describe, expect, it } from 'vitest'

import { deriveMessagingIdentity } from '../crypto/keys'
import { EVM_TEST_MNEMONIC, FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import { MessagingService } from './service'
import { createWakuTransport, WAKU_FILTER_PROTOCOL, WAKU_LIGHTPUSH_PROTOCOL } from './waku'

const LIVE = process.env.WAKU_LIVE === '1'

/** A fresh 32-hex conversation id, so two runs never share a topic. */
function liveConversationId(): string {
  return Date.now().toString(16).padStart(8, '0') + 'a'.repeat(24)
}

describe.runIf(LIVE)('Waku transport, live', () => {
  it('connects a light node and carries a frame back to this subscriber', async () => {
    const transport = await createWakuTransport({ peerTimeoutMs: 45_000 })
    const topic = `/oblivion/1/${liveConversationId()}/proto`
    const payload = new TextEncoder().encode(`live check ${Date.now()}`)

    let received: Uint8Array | null = null

    try {
      await transport.start()
      await transport.subscribe(topic, ({ bytes }) => {
        received = bytes
      })

      // A moment for the filter subscription to reach the relay before publishing.
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      await transport.publish(topic, payload)

      const deadline = Date.now() + 20_000
      while (received === null && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250))
      }

      expect(WAKU_LIGHTPUSH_PROTOCOL).toContain('lightpush')
      expect(WAKU_FILTER_PROTOCOL).toContain('filter')
      expect(received).not.toBeNull()
      expect(Array.from(received ?? [])).toEqual(Array.from(payload))
    } finally {
      await transport.stop()
    }
  }, 90_000)

  it('carries a sealed direct message between two live light nodes', async () => {
    const aliceKeys = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
    const bobKeys = deriveMessagingIdentity(EVM_TEST_MNEMONIC)

    const aliceTransport = await createWakuTransport({ peerTimeoutMs: 45_000 })
    const bobTransport = await createWakuTransport({ peerTimeoutMs: 45_000 })

    const received: string[] = []

    const alice = new MessagingService({ transport: aliceTransport, identity: aliceKeys })
    const bob = new MessagingService({
      transport: bobTransport,
      identity: bobKeys,
      onMessage: (message) => {
        received.push(message.body)
      },
    })

    try {
      await alice.start()
      await bob.start()
      await alice.watch(bobKeys.publicKey)
      await bob.watch(aliceKeys.publicKey)

      // Two publishes: the first can land before the relay has registered the
      // other side's filter, which is real network behaviour, not a bug.
      const body = `live dm ${Date.now()}`

      for (let attempt = 0; attempt < 3 && received.length === 0; attempt += 1) {
        await alice.sendText(bobKeys.publicKey, body)
        await new Promise((resolve) => setTimeout(resolve, 3_000))
      }

      expect(received).toContain(body)
    } finally {
      await alice.stop()
      await bob.stop()
    }
  }, 120_000)
})
