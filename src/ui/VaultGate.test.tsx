import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { MemoryVaultStorage } from '../vault/storage'
import { Vault } from '../vault/vault'
import { CONFIRM_WORD_INDICES } from './gate-copy'

const PASSWORD = 'correct horse battery staple'

function testVault(storage: MemoryVaultStorage): Vault {
  return new Vault({ storage, kdfProfile: 'test', allowTestProfile: true })
}

async function renderCreating() {
  const storage = new MemoryVaultStorage()
  const user = userEvent.setup()

  render(<App vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()} />)
  await screen.findByRole('heading', { name: 'Create your vault' })

  return { user, storage, view: document.body }
}

function readPhrase(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="recovery-phrase"] .word-text')).map(
    (node) => node.textContent?.trim() ?? '',
  )
}

async function createVaultThroughUi() {
  const { user, storage, view } = await renderCreating()

  await user.type(screen.getByLabelText('New password'), PASSWORD)
  await user.type(screen.getByLabelText('Repeat password'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Create vault' }))
  await screen.findByTestId('recovery-phrase')

  return { user, storage, view }
}

describe('creating a vault', () => {
  it('rejects a password that is too short', async () => {
    const { user } = await renderCreating()

    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Repeat password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Create vault' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters')
  })

  it('rejects two passwords that do not match', async () => {
    const { user } = await renderCreating()

    await user.type(screen.getByLabelText('New password'), PASSWORD)
    await user.type(screen.getByLabelText('Repeat password'), `${PASSWORD}!`)
    await user.click(screen.getByRole('button', { name: 'Create vault' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
  })

  it('shows the recovery phrase once the vault exists', async () => {
    const { view } = await createVaultThroughUi()

    expect(screen.getByRole('heading', { name: 'Write down your recovery phrase' })).toBeVisible()
    expect(readPhrase(view)).toHaveLength(12)
  })

  it('keeps the backup step on screen instead of jumping to the dashboard', async () => {
    await createVaultThroughUi()

    expect(screen.queryByRole('heading', { name: 'Your identity' })).toBeNull()
  })

  it('asks for exactly the three confirmation words', async () => {
    const { user } = await createVaultThroughUi()

    await user.click(screen.getByRole('button', { name: 'I have written it down' }))
    await screen.findByRole('heading', { name: 'Confirm three words' })

    for (const wordIndex of CONFIRM_WORD_INDICES) {
      expect(screen.getByLabelText(`Word #${wordIndex + 1}`)).toBeVisible()
    }
    expect(screen.queryByLabelText('Word #2')).toBeNull()
  })

  it('refuses confirmation words that do not match', async () => {
    const { user } = await createVaultThroughUi()

    await user.click(screen.getByRole('button', { name: 'I have written it down' }))
    await screen.findByRole('heading', { name: 'Confirm three words' })

    for (const wordIndex of CONFIRM_WORD_INDICES) {
      await user.type(screen.getByLabelText(`Word #${wordIndex + 1}`), 'wrongword')
    }
    await user.click(screen.getByRole('button', { name: 'Confirm and open my vault' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('do not match the phrase')
  })

  it('opens the dashboard after the phrase is confirmed, and hides the phrase', async () => {
    const { user, view } = await createVaultThroughUi()
    const phrase = readPhrase(view)

    await user.click(screen.getByRole('button', { name: 'I have written it down' }))
    await screen.findByRole('heading', { name: 'Confirm three words' })

    for (const wordIndex of CONFIRM_WORD_INDICES) {
      await user.type(screen.getByLabelText(`Word #${wordIndex + 1}`), phrase[wordIndex] ?? '')
    }
    await user.click(screen.getByRole('button', { name: 'Confirm and open my vault' }))

    expect(await screen.findByRole('heading', { name: 'Your identity' })).toBeVisible()
    expect(screen.queryByTestId('recovery-phrase')).toBeNull()
  })
})

describe('unlocking a vault', () => {
  it('rejects a wrong password', async () => {
    const storage = new MemoryVaultStorage()
    const setup = testVault(storage)
    await setup.create(PASSWORD)
    setup.lock()

    const user = userEvent.setup()
    render(<App vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()} />)
    await screen.findByRole('heading', { name: 'Unlock your vault' })

    await user.type(screen.getByLabelText('Password'), 'definitely not it')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('did not open the vault')
  })

  it('opens the dashboard with the right password', async () => {
    const storage = new MemoryVaultStorage()
    const setup = testVault(storage)
    await setup.create(PASSWORD)
    setup.lock()

    const user = userEvent.setup()
    render(<App vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()} />)
    await screen.findByRole('heading', { name: 'Unlock your vault' })

    await user.type(screen.getByLabelText('Password'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('heading', { name: 'Your identity' })).toBeVisible()
  })

  it('notes that a reload always starts locked', async () => {
    const storage = new MemoryVaultStorage()
    const setup = testVault(storage)
    await setup.create(PASSWORD)
    setup.lock()

    render(<App vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()} />)

    expect(
      await screen.findByText(/key exists only while this tab has your password/i),
    ).toBeVisible()
  })
})
