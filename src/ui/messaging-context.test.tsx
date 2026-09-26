import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  decodeIdentity,
  deriveMessagingIdentity,
  deriveWalletAccount,
  encodeIdentity,
  type HexString,
} from '../crypto/keys'
import { EVM_TEST_MNEMONIC } from '../crypto/vectors'
import { encodePayload, sealMessage } from '../messaging/envelope'
import { InMemoryNetwork } from '../messaging/in-memory-transport'
import { MessagingService, type ReceivedMessage } from '../messaging/service'
import { contentTopicFor, conversationIdFor } from '../messaging/identity'
import { decodePaymentReceiptBody, decodePaymentRequestBody } from '../messaging/payments'
import {
  UnlockedMessagingHarness,
  fakeWalletService,
  offlineWalletFactory,
} from '../test/ui-harness'
import { FakeChain, createFakeSender } from '../wallet/fake-chain'
import type { WalletFactory } from './wallet-context'
import { MessagingPanel } from './MessagingPanel'

const CONTACT_KEYS = deriveMessagingIdentity(EVM_TEST_MNEMONIC)
const CONTACT_ADDRESS = deriveWalletAccount(EVM_TEST_MNEMONIC).address
const TX_HASH = `0x${'ab'.repeat(32)}` as HexString

/** The panel, over one shared in-memory network. */
function renderPanel(
  network = new InMemoryNetwork(),
  factory: WalletFactory = offlineWalletFactory(),
) {
  render(
    <UnlockedMessagingHarness
      transportFactory={() => network.createTransport('panel')}
      factory={factory}
    >
      <MessagingPanel />
    </UnlockedMessagingHarness>,
  )

  return network
}

async function ready() {
  await screen.findByRole('heading', { name: 'Messages' }, { timeout: 5_000 })
  await waitFor(() => {
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Local only (this tab)')
  })
}

/** The panel's own identity string, read out of the UI. */
function panelIdentity(): string {
  return screen.getByTestId('messaging-identity').textContent?.trim() ?? ''
}

/** The public key inside that identity string. */
async function panelPublicKey(): Promise<HexString> {
  return decodeIdentity(panelIdentity())
}

async function addContact(label: string) {
  const user = userEvent.setup()
  const identity = await encodeIdentity(CONTACT_KEYS.publicKey)

  await user.type(screen.getByLabelText('Contact identity'), identity)
  await user.type(screen.getByLabelText('Name'), label)
  await user.click(screen.getByRole('button', { name: 'Add contact' }))

  return user
}

describe('identity', () => {
  it('shows the chat identity, its fingerprint and a QR for it', async () => {
    renderPanel()
    await ready()

    expect(panelIdentity().startsWith('oblivion1')).toBe(true)
    expect(screen.getByTestId('messaging-fingerprint').textContent).toMatch(
      /^[0-9a-f]{4}-[0-9a-f]{4}$/,
    )
    expect(screen.getByRole('img', { name: /Your Oblivion chat identity/ })).toBeVisible()
  })

  it('says out loud that messages stay in this tab until Waku is connected', async () => {
    renderPanel()
    await ready()

    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Local only')
    expect(screen.getByRole('button', { name: 'Connect to Waku' })).toBeEnabled()
  })
})

describe('contacts', () => {
  it('starts with no contacts', async () => {
    renderPanel()
    await ready()

    expect(screen.getByTestId('contacts-empty')).toBeVisible()
    expect(screen.getByTestId('thread-empty')).toBeVisible()
  })

  it('adds a contact by identity string and starts a thread', async () => {
    const network = renderPanel()
    await ready()

    await addContact('Ada')

    expect(await screen.findByTestId('contact-list')).toHaveTextContent('Ada')
    expect(screen.getByRole('heading', { name: 'Conversation with Ada' })).toBeVisible()
    expect(screen.getByTestId('conversation-topic')).toHaveTextContent(`/oblivion/1/`)
    expect(network.subscriberCount).toBeDefined()
  })

  it('refuses a pasted wallet address', async () => {
    renderPanel()
    await ready()

    const user = userEvent.setup()
    await user.type(
      screen.getByLabelText('Contact identity'),
      '0xf7A5DAfFb67f3f235a448Bd3b1AD22C0913D90f4',
    )
    await user.click(screen.getByRole('button', { name: 'Add contact' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/not a contact identity/i)
  })

  it('refuses your own identity', async () => {
    renderPanel()
    await ready()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Contact identity'), panelIdentity())
    await user.click(screen.getByRole('button', { name: 'Add contact' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/that is your own identity/i)
  })

  it('removes a contact and its thread', async () => {
    renderPanel()
    await ready()
    await addContact('Ada')

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByTestId('contacts-empty')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Conversation with Ada' })).toBeNull()
  })
})

describe('conversations', () => {
  it('seals and stores a message, then shows it in the thread', async () => {
    const network = renderPanel()
    await ready()
    const user = await addContact('Ada')

    await user.type(screen.getByLabelText('Message'), 'hello from the panel')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const list = await screen.findByTestId('message-list')
    expect(list).toHaveTextContent('hello from the panel')
    expect(list).toHaveTextContent('You')
    expect(network.published).toBe(1)
  })

  it('walks a message through the wire and back into the vault', async () => {
    const network = renderPanel()
    await ready()
    const user = await addContact('Ada')

    // What the wire carried, decoded as the contact would see it.
    const frames: Uint8Array[] = []
    const publish = network.publish.bind(network)
    network.publish = async (topic, bytes) => {
      frames.push(bytes)
      await publish(topic, bytes)
    }

    await user.type(screen.getByLabelText('Message'), 'a private hello')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByTestId('message-list')

    expect(new TextDecoder().decode(frames[0])).not.toContain('a private hello')

    // The contact replies to the identity the panel published.
    const panelKey = await panelPublicKey()

    const replyService = new MessagingService({
      transport: network.createTransport('contact'),
      identity: { privateKey: CONTACT_KEYS.privateKey, publicKey: CONTACT_KEYS.publicKey },
    })

    await replyService.start()
    await replyService.watch(panelKey)
    await replyService.sendText(panelKey, 'and a private reply')

    // The frame must be accepted: no rejection banner, and no bare timeout.
    expect(screen.queryByTestId('messaging-error')).toBeNull()

    await waitFor(() => {
      expect(screen.getByTestId('message-list')).toHaveTextContent('and a private reply')
    })
    expect(screen.getByTestId('message-list')).toHaveTextContent('Ada')
  })

  it('refuses to send an empty message', async () => {
    renderPanel()
    await ready()
    await addContact('Ada')

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('reports a frame it cannot open instead of pretending it arrived', async () => {
    const network = renderPanel()
    await ready()
    await addContact('Ada')

    const panelKey = await panelPublicKey()
    const conversationId = conversationIdFor(panelKey, CONTACT_KEYS.publicKey)

    await network.publish(contentTopicFor(conversationId), new TextEncoder().encode('{"nope":1}'))

    expect(await screen.findByTestId('messaging-error')).toHaveTextContent(/message/i)
    expect(screen.queryByTestId('message-list')).toBeNull()
  })
})

describe('pay-in-chat', () => {
  /** A raw service standing in for the other side of the chat. */
  async function contactService(
    network: InMemoryNetwork,
    onMessage?: (message: ReceivedMessage) => void,
  ): Promise<MessagingService> {
    const service = new MessagingService({
      transport: network.createTransport('contact'),
      identity: { privateKey: CONTACT_KEYS.privateKey, publicKey: CONTACT_KEYS.publicKey },
      onMessage,
    })

    await service.start()
    return service
  }

  it('asks the other side for ETH, keeps the request in the thread and on the wire', async () => {
    const network = renderPanel()
    await ready()

    const user = await addContact('Ada')
    const received: ReceivedMessage[] = []
    const contact = await contactService(network, (message) => {
      received.push(message)
    })
    await contact.watch(await panelPublicKey())

    await user.type(screen.getByTestId('payment-request-amount'), '0.001')
    await user.type(screen.getByTestId('payment-request-note'), 'split the faucet drop')
    await user.click(screen.getByTestId('payment-request-submit'))

    expect(await screen.findByTestId('payment-request-status')).toHaveTextContent(
      'Asked Ada for 0.001 ETH.',
    )

    const card = await screen.findByTestId('payment-card')
    expect(card).toHaveAttribute('data-payment-kind', 'payment-request')
    expect(screen.getByTestId('payment-status')).toHaveTextContent('Waiting for them to pay.')

    // The contact reads exactly what the panel promised, with their address as
    // the payee: nothing about the request is lost in the sealing.
    await waitFor(() => {
      expect(received).toHaveLength(1)
    })
    expect(received[0]?.kind).toBe('payment-request')

    const request = decodePaymentRequestBody(received[0]?.body ?? '')
    expect(request.amountWei).toBe(1_000_000_000_000_000n)
    expect(request.note).toBe('split the faucet drop')
    expect(screen.getByTestId('payment-payto')).toHaveTextContent(request.payTo)
  })

  it('pays a request in one click and posts the hash back into the thread', async () => {
    const network = new InMemoryNetwork()
    const chain = new FakeChain({ balanceWei: 10n ** 18n })
    const sender = createFakeSender({ hash: TX_HASH })

    renderPanel(network, () => fakeWalletService(chain, sender))

    await ready()
    await addContact('Ada')

    const received: ReceivedMessage[] = []
    const contact = await contactService(network, (message) => {
      received.push(message)
    })
    await contact.watch(await panelPublicKey())

    await contact.sendPaymentRequest(await panelPublicKey(), {
      amountWei: 1_000_000_000_000_000n,
      payTo: CONTACT_ADDRESS,
      note: 'split the faucet drop',
    })

    const card = await screen.findByTestId('payment-card')
    expect(card).toHaveAttribute('data-payment-kind', 'payment-request')

    // The fee is fetched and shown before the button is usable, so "one
    // confirmation" is not "one surprise".
    await waitFor(() => {
      expect(screen.getByTestId('payment-fee')).toHaveTextContent(/Worst-case fee/)
    })

    const user = userEvent.setup()
    const pay = screen.getByTestId('payment-pay')
    expect(pay).toBeEnabled()
    await user.click(pay)

    await waitFor(() => {
      expect(screen.getByTestId('payment-status')).toHaveTextContent('Paid.')
    })

    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]?.to).toBe(CONTACT_ADDRESS)
    expect(sender.sent[0]?.valueWei).toBe(1_000_000_000_000_000n)

    // The hash goes back to the requester, sealed like everything else.
    await waitFor(() => {
      expect(received).toHaveLength(1)
    })
    expect(received[0]?.kind).toBe('payment-receipt')

    const receipt = decodePaymentReceiptBody(received[0]?.body ?? '')
    expect(receipt.status).toBe('paid')
    expect(receipt.txHash).toBe(TX_HASH)
    expect(screen.getByTestId('message-list')).toHaveTextContent(TX_HASH)
    expect(screen.queryByTestId('payment-error')).toBeNull()
  })

  it('declines without touching the chain', async () => {
    const network = new InMemoryNetwork()
    const chain = new FakeChain({ balanceWei: 10n ** 18n })
    const sender = createFakeSender({ hash: TX_HASH })

    renderPanel(network, () => fakeWalletService(chain, sender))

    await ready()
    await addContact('Ada')

    const received: ReceivedMessage[] = []
    const contact = await contactService(network, (message) => {
      received.push(message)
    })
    await contact.watch(await panelPublicKey())

    await contact.sendPaymentRequest(await panelPublicKey(), {
      amountWei: 1n,
      payTo: CONTACT_ADDRESS,
    })

    await screen.findByTestId('payment-card')

    const user = userEvent.setup()
    await user.click(screen.getByTestId('payment-decline'))

    await waitFor(() => {
      expect(screen.getByTestId('payment-status')).toHaveTextContent('Declined.')
    })

    expect(sender.sent).toHaveLength(0)

    await waitFor(() => {
      expect(received).toHaveLength(1)
    })

    const receipt = decodePaymentReceiptBody(received[0]?.body ?? '')
    expect(receipt.status).toBe('declined')
    expect(receipt.txHash).toBeNull()
  })

  it('says up front when the wallet cannot cover the amount and the fee', async () => {
    const network = new InMemoryNetwork()
    const chain = new FakeChain({ balanceWei: 1n })

    renderPanel(network, () => fakeWalletService(chain, createFakeSender()))

    await ready()
    await addContact('Ada')

    const contact = await contactService(network)
    await contact.watch(await panelPublicKey())

    await contact.sendPaymentRequest(await panelPublicKey(), {
      amountWei: 10n ** 18n,
      payTo: CONTACT_ADDRESS,
    })

    await screen.findByTestId('payment-card')

    await waitFor(() => {
      expect(screen.getByTestId('payment-shortfall')).toBeVisible()
    })
    expect(screen.getByTestId('payment-pay')).toBeDisabled()
  })

  it('renders a receipt that arrived on its own, hash and all', async () => {
    const network = renderPanel()
    await ready()
    await addContact('Ada')

    const contact = await contactService(network)
    await contact.watch(await panelPublicKey())

    await contact.sendPaymentReceipt(await panelPublicKey(), {
      requestId: `pay-${'b'.repeat(32)}`,
      status: 'paid',
      txHash: TX_HASH,
    })

    await waitFor(() => {
      expect(screen.getByTestId('payment-receipt-status')).toHaveTextContent(
        'Ada paid this request.',
      )
    })
    expect(screen.getByTestId('payment-receipt-hash')).toHaveTextContent(TX_HASH)
    expect(screen.getByRole('link', { name: 'Open in explorer' })).toHaveAttribute(
      'href',
      `https://sepolia.etherscan.io/tx/${TX_HASH}`,
    )
  })

  it('reports a payment frame it cannot read instead of offering to pay it', async () => {
    const network = renderPanel()
    await ready()
    await addContact('Ada')

    const panelKey = await panelPublicKey()
    const conversationId = conversationIdFor(panelKey, CONTACT_KEYS.publicKey)

    const service = await contactService(network)
    await service.watch(panelKey)

    // Signed and sealed by the contact, labelled as a payment, unreadable inside.
    const payload = await sealMessage({
      plaintext: 'not a payment at all',
      kind: 'payment-request',
      senderPrivateKey: CONTACT_KEYS.privateKey,
      senderPublicKey: CONTACT_KEYS.publicKey,
      recipientPublicKey: panelKey,
      conversationId,
      sentAt: '2026-09-26T12:00:00.000Z',
    })

    await network.publish(contentTopicFor(conversationId), encodePayload(payload))

    expect(await screen.findByTestId('messaging-error')).toHaveTextContent(/JSON|payment/i)
    expect(screen.queryByTestId('payment-card')).toBeNull()
  })
})

describe('connection', () => {
  it('reports a transport that cannot start', async () => {
    render(
      <UnlockedMessagingHarness
        transportFactory={() => ({
          name: 'broken',
          start: async () => {
            throw new Error('the transport refused to start')
          },
          stop: async () => undefined,
          subscribe: async () => () => undefined,
          publish: async () => undefined,
        })}
      >
        <MessagingPanel />
      </UnlockedMessagingHarness>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('messaging-error')).toHaveTextContent(/refused to start/)
    })
    expect(screen.getByTestId('connection-pill')).toHaveTextContent('Not connected')
  })

  it('switches transport when asked, and says which one is live', async () => {
    const network = new InMemoryNetwork()
    const used: string[] = []

    render(
      <UnlockedMessagingHarness
        transportFactory={(mode) => {
          used.push(mode)
          return network.createTransport(mode)
        }}
      >
        <MessagingPanel />
      </UnlockedMessagingHarness>,
    )

    await ready()
    expect(used).toEqual(['local'])

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect to Waku' }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-pill')).toHaveTextContent('Waku network')
    })
    expect(used).toEqual(['local', 'waku'])
  })
})
