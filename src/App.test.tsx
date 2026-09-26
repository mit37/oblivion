import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'
import { SAFETY_LABEL, SAFETY_WARNING } from './safety'
import { MemoryVaultStorage } from './vault/storage'
import { Vault } from './vault/vault'

const PASSWORD = 'correct horse battery staple'

function testVault(storage: MemoryVaultStorage): Vault {
  return new Vault({ storage, kdfProfile: 'test', allowTestProfile: true })
}

function renderApp(storage = new MemoryVaultStorage()): MemoryVaultStorage {
  render(<App vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()} />)
  return storage
}

describe('app shell', () => {
  it('renders the required prototype / unaudited / testnet-only safety banner', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Create your vault' })

    const banner = screen.getByTestId('safety-banner')
    expect(banner).toHaveTextContent(SAFETY_LABEL)
    expect(banner).toHaveTextContent('testnet only')
    expect(banner).toHaveTextContent(SAFETY_WARNING)
    expect(banner).toHaveTextContent('Do not use with real funds or sensitive conversations.')
  })

  it('names the app', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Create your vault' })

    expect(screen.getByRole('heading', { level: 1, name: 'Oblivion' })).toBeVisible()
  })

  it('offers to create a vault on a device with no vault', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { name: 'Create your vault' })).toBeVisible()
  })

  it('offers to unlock when a vault already exists on this device', async () => {
    const storage = new MemoryVaultStorage()
    const setup = testVault(storage)
    await setup.create(PASSWORD)
    setup.lock()

    renderApp(storage)

    expect(await screen.findByRole('heading', { name: 'Unlock your vault' })).toBeVisible()
  })

  it('never auto-unlocks on load, even with a vault in storage', async () => {
    const storage = new MemoryVaultStorage()
    const setup = testVault(storage)
    await setup.create(PASSWORD)
    setup.lock()

    renderApp(storage)
    await screen.findByRole('heading', { name: 'Unlock your vault' })

    expect(screen.queryByRole('heading', { name: 'Your identity' })).toBeNull()
  })
})
