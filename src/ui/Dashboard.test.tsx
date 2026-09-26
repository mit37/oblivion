import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { offlineWalletFactory } from '../test/ui-harness'
import { MemoryVaultStorage } from '../vault/storage'
import { Vault } from '../vault/vault'

const PASSWORD = 'correct horse battery staple'
const NEW_PASSWORD = 'the second password, longer'
const DELETE_CONFIRMATION = 'DELETE'

function testVault(storage: MemoryVaultStorage): Vault {
  return new Vault({ storage, kdfProfile: 'test', allowTestProfile: true })
}

async function renderUnlocked() {
  const storage = new MemoryVaultStorage()
  const setup = testVault(storage)
  const created = await setup.create(PASSWORD)
  setup.lock()

  const user = userEvent.setup()
  render(
    <App
      vaultFactory={() => testVault(storage)}
      autoLockTarget={new EventTarget()}
      walletFactory={offlineWalletFactory()}
    />,
  )

  await screen.findByRole('heading', { name: 'Unlock your vault' })
  await user.type(screen.getByLabelText('Password'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Unlock' }))
  await screen.findByRole('heading', { name: 'Your identity' })

  return { user, storage, mnemonic: created.mnemonic }
}

function rowFor(title: string): HTMLElement {
  const row = screen.getByText(title).closest('li')

  if (!row) throw new Error(`no milestone row for "${title}"`)

  return row
}

function readRevealedPhrase(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="recovery-phrase"] .word-text')).map(
    (node) => node.textContent?.trim() ?? '',
  )
}

describe('identity card', () => {
  it('shows the wallet address and the messaging identity separately', async () => {
    await renderUnlocked()

    // The identity card, not the messaging panel that repeats the chat key.
    const card = screen.getByRole('region', { name: 'Your identity' })

    expect(within(card).getByText("m/44'/60'/0'/0/0")).toBeVisible()
    expect(within(card).getByText("m/44'/60'/1'/0/0")).toBeVisible()
    expect(within(card).getByText(/^oblivion1/)).toBeVisible()
  })

  it('states the network restriction in the identity card', async () => {
    await renderUnlocked()

    const card = screen.getByRole('region', { name: 'Your identity' })
    expect(within(card).getByText(/chain ID 11155111/)).toBeVisible()
  })

  it('shows the wallet only while the vault is unlocked', async () => {
    const { user } = await renderUnlocked()

    expect(screen.getByRole('heading', { name: 'Testnet wallet' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Lock now' }))

    expect(await screen.findByRole('heading', { name: 'Unlock your vault' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Testnet wallet' })).toBeNull()
  })
})

describe('locking', () => {
  it('returns to the unlock gate', async () => {
    const { user } = await renderUnlocked()

    await user.click(screen.getByRole('button', { name: 'Lock now' }))

    expect(await screen.findByRole('heading', { name: 'Unlock your vault' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Your identity' })).toBeNull()
  })
})

describe('recovery phrase', () => {
  it('refuses to reveal without the right password', async () => {
    const { user } = await renderUnlocked()

    await user.type(screen.getByLabelText('Password'), 'not the password')
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('did not open the vault')
    expect(document.querySelector('[data-testid="recovery-phrase"]')).toBeNull()
  })

  it('reveals the phrase after the password, and can hide it again', async () => {
    const { user, mnemonic } = await renderUnlocked()

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Reveal recovery phrase' }))

    expect(await screen.findByTestId('recovery-phrase')).toBeVisible()
    expect(readRevealedPhrase().join(' ')).toBe(mnemonic)

    await user.click(screen.getByRole('button', { name: 'Hide phrase' }))
    expect(document.querySelector('[data-testid="recovery-phrase"]')).toBeNull()
  })
})

describe('changing the password', () => {
  it('re-wraps the vault and retires the old password', async () => {
    const { user } = await renderUnlocked()

    await user.type(screen.getByLabelText('Current password'), PASSWORD)
    await user.type(screen.getByLabelText('New password'), NEW_PASSWORD)
    await user.type(screen.getByLabelText('Repeat new password'), NEW_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Password changed')

    await user.click(screen.getByRole('button', { name: 'Lock now' }))
    await screen.findByRole('heading', { name: 'Unlock your vault' })

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('did not open the vault')

    await user.type(screen.getByLabelText('Password'), NEW_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('heading', { name: 'Your identity' })).toBeVisible()
  })

  it('reports mismatched new passwords', async () => {
    const { user } = await renderUnlocked()

    await user.type(screen.getByLabelText('Current password'), PASSWORD)
    await user.type(screen.getByLabelText('New password'), NEW_PASSWORD)
    await user.type(screen.getByLabelText('Repeat new password'), `${NEW_PASSWORD}!`)
    await user.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByRole('status')).toHaveTextContent('do not match')
  })
})

describe('deleting the vault', () => {
  it('requires the typed confirmation', async () => {
    const { user, storage } = await renderUnlocked()

    await user.type(screen.getByLabelText(`Type ${DELETE_CONFIRMATION} to confirm`), 'delete')
    await user.click(screen.getByRole('button', { name: 'Delete vault' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(`Type ${DELETE_CONFIRMATION}`)
    expect(await storage.read()).not.toBeNull()
  })

  it('removes the record and returns to the create screen', async () => {
    const { user, storage } = await renderUnlocked()

    await user.type(
      screen.getByLabelText(`Type ${DELETE_CONFIRMATION} to confirm`),
      DELETE_CONFIRMATION,
    )
    await user.click(screen.getByRole('button', { name: 'Delete vault' }))

    expect(await screen.findByRole('heading', { name: 'Create your vault' })).toBeVisible()
    expect(await storage.read()).toBeNull()
  })
})

describe('build status card', () => {
  it('marks the finished milestones done and the rest planned', async () => {
    await renderUnlocked()

    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThanOrEqual(8)

    expect(rowFor('Encrypted vault (create / unlock / lock / re-wrap)')).toHaveClass(
      'milestone--done',
    )
    expect(rowFor('Ethereum Sepolia wallet (balance, receive, send, history)')).toHaveClass(
      'milestone--done',
    )
    expect(rowFor('Waku 1:1 end-to-end encrypted messaging')).toHaveClass('milestone--done')
    expect(rowFor('Pay-in-chat payment requests')).toHaveClass('milestone--planned')
  })
})
