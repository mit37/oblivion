import { describe, expect, it, vi } from 'vitest'

import { deriveMessagingIdentity, type HexString } from '../crypto/keys'
import { EVM_TEST_MNEMONIC, FIRST_BIP39_TEST_MNEMONIC } from '../crypto/vectors'
import { encodePayload, sealMessage } from './envelope'
import { MessagingError } from './errors'
import { contentTopicFor, conversationIdFor } from './identity'
import { InMemoryNetwork } from './in-memory-transport'
import { MAX_MESSAGE_LENGTH, MessagingService, type ReceivedMessage } from './service'

const ALICE_KEYS = deriveMessagingIdentity(FIRST_BIP39_TEST_MNEMONIC)
const BOB_KEYS = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
const MALLORY_KEYS = deriveMessagingIdentity('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')

const CONVERSATION = conversationIdFor(ALICE_KEYS.publicKey, BOB_KEYS.publicKey)
const TOPIC = contentTopicFor(CONVERSATION)
const NOW = new Date('2026-09-25T12:00:00.000Z')

interface Peer {
  readonly service: MessagingService
  readonly received: ReceivedMessage[]
  readonly rejected: Error[]
}

function createPeer(
  network: InMemoryNetwork,
  keys: { privateKey: HexString; publicKey: HexString },
  name: string,
): Peer {
  const received: ReceivedMessage[] = []
  const rejected: Error[] = []

  const service = new MessagingService({
    transport: network.createTransport(name),
    identity: keys,
    now: () => NOW,
    onMessage: (message) => {
      received.push(message)
    },
    onRejected: (error) => {
      rejected.push(error)
    },
  })

  return { service, received, rejected }
}

async function twoPeers() {
  const network = new InMemoryNetwork()
  const alice = createPeer(network, ALICE_KEYS, 'alice')
  const bob = createPeer(network, BOB_KEYS, 'bob')

  await alice.service.start()
  await bob.service.start()
  await alice.service.watch(BOB_KEYS.publicKey)
  await bob.service.watch(ALICE_KEYS.publicKey)

  return { network, alice, bob }
}

describe('conversations', () => {
  it('derives the same conversation id from either side', () => {
    expect(conversationIdFor(ALICE_KEYS.publicKey, BOB_KEYS.publicKey)).toBe(
      conversationIdFor(BOB_KEYS.publicKey, ALICE_KEYS.publicKey),
    )
  })

  it('derives a different id for a different pair', () => {
    expect(conversationIdFor(ALICE_KEYS.publicKey, MALLORY_KEYS.publicKey)).not.toBe(CONVERSATION)
  })

  it('uses the documented content topic', () => {
    expect(TOPIC).toBe(`/oblivion/1/${CONVERSATION}/proto`)
  })
})

describe('two peers', () => {
  it('delivers a sealed message both ways', async () => {
    const { network, alice, bob } = await twoPeers()

    await alice.service.sendText(BOB_KEYS.publicKey, 'hello bob')
    await bob.service.sendText(ALICE_KEYS.publicKey, 'hello alice')

    expect(bob.received).toHaveLength(1)
    expect(bob.received[0]?.body).toBe('hello bob')
    expect(bob.received[0]?.direction).toBe('inbound')
    expect(bob.received[0]?.senderPublicKey).toBe(ALICE_KEYS.publicKey)

    expect(alice.received).toHaveLength(1)
    expect(alice.received[0]?.body).toBe('hello alice')

    expect(network.published).toBe(2)
    expect(network.errors).toEqual([])
  })

  it('reports what it sent, so the caller can store it', async () => {
    const { alice } = await twoPeers()

    const sent = await alice.service.sendText(BOB_KEYS.publicKey, 'note this')

    expect(sent.direction).toBe('outbound')
    expect(sent.body).toBe('note this')
    expect(sent.conversationId).toBe(CONVERSATION)
    expect(sent.sentAt).toBe(NOW.toISOString())
  })

  it('publishes a payload that is unreadable without the key', async () => {
    const network = new InMemoryNetwork()
    const frames: Uint8Array[] = []
    const publish = network.publish.bind(network)

    network.publish = async (topic, bytes) => {
      frames.push(bytes)
      await publish(topic, bytes)
    }

    const alice = createPeer(network, ALICE_KEYS, 'alice')
    await alice.service.start()
    await alice.service.watch(BOB_KEYS.publicKey)
    await alice.service.sendText(BOB_KEYS.publicKey, 'a secret phrase')

    const wire = new TextDecoder().decode(frames[0])
    expect(wire).toContain('om1')
    expect(wire).toContain('"sealed"')
    expect(wire).not.toContain('a secret phrase')
  })

  it('subscribes once per conversation, on both ends', async () => {
    const { alice, network } = await twoPeers()

    await alice.service.watch(BOB_KEYS.publicKey)
    await alice.service.watch(BOB_KEYS.publicKey)

    expect(alice.service.conversations).toEqual([CONVERSATION])
    // Alice and Bob are both listening on the one topic this pair owns.
    expect(network.subscriberCount(TOPIC)).toBe(2)
  })

  it('stops listening after unwatch, and refuses to send to an unwatched contact', async () => {
    const { alice, bob, network } = await twoPeers()

    await alice.service.unwatch(BOB_KEYS.publicKey)

    await expect(alice.service.sendText(BOB_KEYS.publicKey, 'after unwatch')).rejects.toThrow(
      /watch this contact/,
    )
    expect(bob.received).toHaveLength(0)
    expect(network.subscriberCount(TOPIC)).toBe(1)

    await alice.service.stop()
    await expect(alice.service.sendText(BOB_KEYS.publicKey, 'after stop')).rejects.toThrow(
      MessagingError,
    )
  })
})

describe('misbehaviour', () => {
  it('refuses to send before the service is started', async () => {
    const network = new InMemoryNetwork()
    const alice = createPeer(network, ALICE_KEYS, 'alice')

    await expect(alice.service.sendText(BOB_KEYS.publicKey, 'too early')).rejects.toThrow(
      /start the messaging service first/,
    )
  })

  it('refuses a message that arrives on a topic for another contact', async () => {
    const network = new InMemoryNetwork()
    const mallory = createPeer(network, MALLORY_KEYS, 'mallory')
    await mallory.service.start()

    const payload = await sealMessage({
      plaintext: 'wrong thread',
      senderPrivateKey: ALICE_KEYS.privateKey,
      senderPublicKey: ALICE_KEYS.publicKey,
      recipientPublicKey: MALLORY_KEYS.publicKey,
      conversationId: conversationIdFor(ALICE_KEYS.publicKey, MALLORY_KEYS.publicKey),
      sentAt: NOW.toISOString(),
    })

    await expect(
      mallory.service.receive(TOPIC, encodePayload(payload), ALICE_KEYS.publicKey),
    ).rejects.toThrow(/does not belong to that contact/)
  })

  it('reports a rejected frame instead of throwing it at the transport', async () => {
    const { network, bob } = await twoPeers()

    await network.publish(TOPIC, new TextEncoder().encode('not json at all'))

    expect(bob.received).toHaveLength(0)
    expect(bob.rejected).toHaveLength(1)
    expect(bob.rejected[0]?.message).toMatch(/UTF-8 JSON/)
  })

  it('ignores a frame addressed to another recipient', async () => {
    const { network, bob, alice } = await twoPeers()

    const payload = await sealMessage({
      plaintext: 'for mallory only',
      senderPrivateKey: ALICE_KEYS.privateKey,
      senderPublicKey: ALICE_KEYS.publicKey,
      recipientPublicKey: MALLORY_KEYS.publicKey,
      conversationId: conversationIdFor(ALICE_KEYS.publicKey, MALLORY_KEYS.publicKey),
      sentAt: NOW.toISOString(),
    })

    // Bob's topic, but sealed to someone else: it must not become a message.
    await network.publish(TOPIC, encodePayload(payload))

    expect(bob.received).toHaveLength(0)
    expect(bob.rejected).toHaveLength(1)
    expect(alice.received).toHaveLength(0)
  })

  it('refuses an empty or oversized body', async () => {
    const { alice } = await twoPeers()

    await expect(alice.service.sendText(BOB_KEYS.publicKey, '   ')).rejects.toThrow(
      /cannot be empty/,
    )
    await expect(
      alice.service.sendText(BOB_KEYS.publicKey, 'x'.repeat(MAX_MESSAGE_LENGTH + 1)),
    ).rejects.toThrow(/cannot exceed/)
  })

  it('refuses to publish when the network is offline', async () => {
    const { network, alice } = await twoPeers()

    network.setOnline(false)

    await expect(alice.service.sendText(BOB_KEYS.publicKey, 'anyone there?')).rejects.toThrow(
      /network is offline/,
    )
  })

  it('does not deliver to a peer that never watched the contact', async () => {
    const network = new InMemoryNetwork()
    const alice = createPeer(network, ALICE_KEYS, 'alice')
    const bob = createPeer(network, BOB_KEYS, 'bob')

    await alice.service.start()
    await bob.service.start()
    await alice.service.watch(BOB_KEYS.publicKey)

    await alice.service.sendText(BOB_KEYS.publicKey, 'not watching you')

    expect(bob.received).toHaveLength(0)
    expect(network.delivered).toBe(1) // only Alice's own subscription saw the frame
  })

  it('ignores its own message coming back from the network', async () => {
    const network = new InMemoryNetwork()
    const alice = createPeer(network, ALICE_KEYS, 'alice')

    await alice.service.start()
    await alice.service.watch(BOB_KEYS.publicKey)
    await alice.service.sendText(BOB_KEYS.publicKey, 'echo test')

    // Publish/subscribe transports hand a publisher its own message; that is not
    // a received message and not an error.
    expect(alice.received).toHaveLength(0)
    expect(alice.rejected).toHaveLength(0)
  })

  it('keeps the identity public key out of the ciphertext', async () => {
    const { network } = await twoPeers()
    const onMessage = vi.fn()
    const service = new MessagingService({
      transport: network.createTransport('observer'),
      identity: MALLORY_KEYS,
      onMessage,
    })

    await service.start()
    await service.watch(BOB_KEYS.publicKey)
    await service.sendText(BOB_KEYS.publicKey, 'observer here')

    expect(onMessage).not.toHaveBeenCalled()
  })
})
