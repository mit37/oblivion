import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { HexString } from '../crypto/keys'
import { fakeWalletService, UnlockedVaultHarness } from '../test/wallet-harness'
import { FakeChain, blockWith, createFakeSender } from '../wallet/fake-chain'
import type { BlockLike } from '../wallet/types'
import { WalletPanel } from './WalletPanel'

const RECIPIENT = `0x${'22'.repeat(20)}` as HexString

async function renderPanel(chain: FakeChain) {
  render(
    <UnlockedVaultHarness factory={() => fakeWalletService(chain, createFakeSender())}>
      <WalletPanel />
    </UnlockedVaultHarness>,
  )

  await screen.findByRole('heading', { name: 'Balance' }, { timeout: 5_000 })

  return chain
}

describe('receive', () => {
  it('encodes an EIP-681 payment URI for this address and chain', async () => {
    await renderPanel(new FakeChain())
    const address = screen.getByTestId('wallet-address').textContent?.trim()

    expect(screen.getByTestId('payment-uri').textContent).toBe(
      `ethereum:${address?.toLowerCase()}@11155111`,
    )
  })

  it('adds the amount to the QR once one is typed', async () => {
    await renderPanel(new FakeChain())
    const user = userEvent.setup()

    const before = screen.getByTestId('qr-code').querySelector('path')?.getAttribute('d')

    await user.type(screen.getByLabelText('Amount to request (ETH, optional)'), '0.01')

    expect(screen.getByTestId('payment-uri').textContent).toMatch(/value=10000000000000000$/)
    expect(screen.getByRole('img', { name: /Receive 0.01 ETH at/ })).toBeVisible()
    expect(screen.getByTestId('qr-code').querySelector('path')?.getAttribute('d')).not.toBe(before)
  })

  it('keeps the plain address QR when the amount is not usable', async () => {
    await renderPanel(new FakeChain())
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Amount to request (ETH, optional)'), '0,01')

    expect(screen.getByText(/plain decimal number/i)).toBeVisible()
    expect(screen.getByTestId('payment-uri').textContent).not.toMatch(/value=/)
  })
})

describe('fee review', () => {
  it('shows gas, fee caps and the total before anything is signed', async () => {
    const chain = new FakeChain({
      balanceWei: 10n ** 18n,
      gasPriceWei: 12_000_000_000n,
      gasEstimate: 21_000n,
    })
    await renderPanel(chain)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Recipient address or payment link'), RECIPIENT)
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.001')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))

    const review = await screen.findByTestId('send-review')

    // 21 000 gas × a 24 gwei cap = 0.000504 ETH worst case.
    expect(review).toHaveTextContent('21000')
    expect(review).toHaveTextContent('24 gwei')
    expect(review).toHaveTextContent('1 gwei')
    expect(screen.getByTestId('estimated-fee')).toHaveTextContent('0.000504 ETH')
    expect(review).toHaveTextContent('0.001504 ETH')
  })

  it('refuses a recipient that is not an address', async () => {
    const chain = await renderPanel(new FakeChain())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Recipient address or payment link'), 'vitalik.eth')
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.001')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a valid 20-byte address/i)
    expect(screen.queryByTestId('send-review')).toBeNull()
    expect(chain.calls).not.toContain('estimateGas')
  })

  it('takes the amount from a payment link when none is typed', async () => {
    await renderPanel(new FakeChain({ balanceWei: 10n ** 18n }))

    const user = userEvent.setup()
    await user.type(
      screen.getByLabelText('Recipient address or payment link'),
      `ethereum:${RECIPIENT}@11155111?value=2500000000000000`,
    )
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))

    expect(await screen.findByRole('button', { name: 'Send 0.0025 ETH' })).toBeVisible()
  })

  it('refuses a link that points at another chain', async () => {
    await renderPanel(new FakeChain())

    const user = userEvent.setup()
    await user.type(
      screen.getByLabelText('Recipient address or payment link'),
      `ethereum:${RECIPIENT}@1?value=1`,
    )
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.001')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/points at chain 1/i)
  })

  it('cancels a reviewed transfer without sending it', async () => {
    const chain = new FakeChain({ balanceWei: 10n ** 18n })
    await renderPanel(chain)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Recipient address or payment link'), RECIPIENT)
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.001')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(screen.queryByTestId('send-review')).toBeNull()
    expect(screen.queryByTestId('sent-transaction')).toBeNull()
  })
})

describe('history', () => {
  it('lists a sent transaction with its block and explorer link', async () => {
    const blocks: Record<string, BlockLike> = {}
    await renderPanel(new FakeChain({ latestBlock: 7n, blocks }))
    const address = screen.getByTestId('wallet-address').textContent?.trim() as HexString

    blocks['7'] = blockWith(7n, [
      {
        hash: `0x${'ab'.repeat(32)}` as HexString,
        from: address,
        to: RECIPIENT,
        valueWei: 10n ** 15n,
      },
    ])

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Scan again' }))

    const list = await screen.findByTestId('history-list')
    expect(list).toHaveTextContent('Sent')
    expect(list).toHaveTextContent('0.001 ETH')
    expect(list).toHaveTextContent('block 7')
    expect(screen.getByRole('link', { name: /0xabababab…ababab/ })).toHaveAttribute(
      'href',
      expect.stringContaining('sepolia.etherscan.io/tx/'),
    )
  })
})

describe('copy feedback', () => {
  it('confirms a real copy instead of assuming one', async () => {
    await renderPanel(new FakeChain())
    const address = screen.getByTestId('wallet-address').textContent?.trim()

    // `userEvent.setup()` installs a working clipboard stub, so this exercises
    // the success path of the component rather than a mock of it.
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Copy address' })[0]!)

    expect(await screen.findByRole('status')).toHaveTextContent('Copied.')
    await expect(navigator.clipboard.readText()).resolves.toBe(address)
  })

  it('says so when the clipboard refuses', async () => {
    await renderPanel(new FakeChain())

    const user = userEvent.setup()

    // A denied clipboard with no legacy fallback is the headless case.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied by the browser')) },
    })

    await user.click(screen.getAllByRole('button', { name: 'Copy address' })[0]!)

    expect(await screen.findByRole('alert')).toHaveTextContent(/copying is blocked here/i)
  })
})
