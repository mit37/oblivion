import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  decodeIdentity,
  deriveMessagingIdentity,
  encodeIdentity,
  type HexString,
} from '../crypto/keys'
import { EVM_TEST_MNEMONIC } from '../crypto/vectors'
import { InMemoryNetwork } from '../messaging/in-memory-transport'
import { MessagingService } from '../messaging/service'
import { contentTopicFor, conversationIdFor } from '../messaging/identity'
import { UnlockedMessagingHarness } from '../test/ui-harness'
import { MessagingPanel } from './MessagingPanel'

const CONTACT_KEYS = deriveMessagingIdentity(EVM_TEST_MNEMONIC)

/** The panel, over one shared in-memory network. */
function renderPanel(network = new InMemoryNetwork()) {
  render(
    <UnlockedMessagingHarness transportFactory={() => network.createTransport('panel')}>
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
