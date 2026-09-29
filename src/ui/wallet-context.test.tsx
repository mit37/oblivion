import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { fakeWalletService, UnlockedVaultHarness } from '../test/ui-harness'
import { FakeChain, createFakeSender, blockWith } from '../wallet/fake-chain'
import type { HexString } from '../crypto/keys'
import type { BlockLike } from '../wallet/types'
import { WalletError } from '../wallet/chain'
import { WalletPanel } from './WalletPanel'

const RECIPIENT = `0x${'22'.repeat(20)}` as HexString
const TOKEN = `0x${'33'.repeat(20)}` as HexString

/**
 * Renders the wallet panel over a fake chain and waits until it is mounted, so
 * each test can use synchronous queries from then on.
 */
async function renderWallet(chain: FakeChain, sender = createFakeSender()) {
  render(
    <UnlockedVaultHarness factory={() => fakeWalletService(chain, sender)}>
      <WalletPanel />
    </UnlockedVaultHarness>,
  )

  await screen.findByRole('heading', { name: 'Balance' }, { timeout: 5_000 })

  return { chain, sender }
}

describe('wallet provider', () => {
  it('loads the balance for the vault address', async () => {
    const chain = new FakeChain({ balanceWei: 1_500_000_000_000_000n })
    await renderWallet(chain)

    expect(await screen.findByText('0.0015 ETH')).toBeVisible()
    expect(chain.calls[0]).toBe('getChainId')
  })

  it('checks the chain before reading anything else', async () => {
    const chain = new FakeChain({ chainId: 1 })
    await renderWallet(chain)

    await waitFor(() => {
      expect(screen.getByTestId('wallet-error')).toBeVisible()
    })

    expect(chain.calls).toEqual(['getChainId'])
  })

  it('names the refusal when the endpoint is mainnet', async () => {
    await renderWallet(new FakeChain({ chainId: 1 }))

    const notice = await screen.findByTestId('wallet-error')
    expect(notice).toHaveAttribute('data-wallet-error-code', 'mainnet-refused')
    expect(notice).toHaveTextContent(/refuses to use Ethereum mainnet/i)
  })

  it('reports an unknown chain separately from mainnet', async () => {
    await renderWallet(new FakeChain({ chainId: 137 }))

    const notice = await screen.findByTestId('wallet-error')
    expect(notice).toHaveAttribute('data-wallet-error-code', 'unsupported-chain')
    expect(notice).toHaveTextContent(/unsupported chain id 137/i)
  })

  it('shows no balance when the chain is refused', async () => {
    await renderWallet(new FakeChain({ chainId: 1 }))

    await screen.findByTestId('wallet-error')
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('—')
  })

  it('ignores transactions that do not involve this address', async () => {
    const chain = new FakeChain({
      latestBlock: 10n,
      blocks: {
        '10': blockWith(10n, [
          { hash: `0x${'ab'.repeat(32)}` as HexString, from: RECIPIENT, to: null, valueWei: 5n },
        ]),
      },
    })

    await renderWallet(chain)

    expect(await screen.findByTestId('history-empty')).toBeVisible()
  })

  it('lists a scanned transaction once a later scan finds one', async () => {
    // The address is derived from a random mnemonic, so the block is filled in
    // after the panel has told us which address to look for.
    const blocks: Record<string, BlockLike> = {}
    const chain = new FakeChain({ latestBlock: 42n, blocks })

    await renderWallet(chain)
    const address = screen.getByTestId('wallet-address').textContent?.trim() as HexString

    blocks['42'] = blockWith(42n, [
      { hash: `0x${'ab'.repeat(32)}` as HexString, from: address, to: RECIPIENT, valueWei: 7n },
    ])

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Scan again' }))

    expect(await screen.findByTestId('history-list')).toHaveTextContent(/Sent/)
  })

  it('sends through the injected sender and records the fee', async () => {
    const sender = createFakeSender({ hash: `0x${'cd'.repeat(32)}` })
    const chain = new FakeChain({ balanceWei: 10n ** 18n })
    await renderWallet(chain, sender)

    expect(await screen.findByText('1 ETH')).toBeVisible()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Recipient address or payment link'), RECIPIENT)
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.001')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))

    await user.click(await screen.findByRole('button', { name: 'Send 0.001 ETH' }))

    await waitFor(() => {
      expect(sender.sent).toHaveLength(1)
    })

    expect(sender.sent[0]?.to).toBe(RECIPIENT)
    expect(sender.sent[0]?.valueWei).toBe(1_000_000_000_000_000n)
  })

  it('refuses to send when the balance cannot cover the fee', async () => {
    const sender = createFakeSender()
    const chain = new FakeChain({ balanceWei: 1_000n })
    await renderWallet(chain, sender)

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Recipient address or payment link'), RECIPIENT)
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.5')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))
    await user.click(await screen.findByRole('button', { name: 'Send 0.5 ETH' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/beyond what this address holds/i)
    expect(sender.sent).toHaveLength(0)
  })

  it('reports a pending transaction until the receipt says otherwise', async () => {
    const hash = `0x${'cd'.repeat(32)}` as HexString
    const chain = new FakeChain({ balanceWei: 10n ** 18n })
    await renderWallet(chain, createFakeSender({ hash }))

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Recipient address or payment link'), RECIPIENT)
    await user.type(screen.getByLabelText('Amount (ETH)'), '0.001')
    await user.click(screen.getByRole('button', { name: 'Review transfer' }))
    await user.click(await screen.findByRole('button', { name: 'Send 0.001 ETH' }))

    expect(await screen.findByTestId('transaction-status')).toHaveTextContent(/pending/i)

    await user.click(screen.getByRole('button', { name: 'Check status' }))

    await waitFor(() => {
      expect(chain.calls).toContain(`getTransactionReceipt:${hash}`)
    })
    expect(screen.getByTestId('transaction-status')).toHaveTextContent(/pending/i)
  })

  it('stores a watched token in the vault and drops it again', async () => {
    const chain = new FakeChain({
      tokens: {
        [TOKEN]: {
          info: { address: TOKEN, name: 'Test USD', symbol: 'TUSD', decimals: 6 },
          balanceWei: 2_500_000n,
        },
      },
    })

    await renderWallet(chain)
    expect(await screen.findByTestId('tokens-empty')).toBeVisible()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Token contract address'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Add token' }))

    expect(await screen.findByText('2.5 TUSD')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByTestId('tokens-empty')).toBeVisible()
  })

  it('refuses a token whose contract does not answer', async () => {
    await renderWallet(new FakeChain())

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Token contract address'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Add token' }))

    expect(await screen.findByText(/no fake token registered/i)).toBeVisible()
  })

  it('surfaces a chain failure without clearing the panel', async () => {
    const chain = new FakeChain()
    chain.getBalance = async () => {
      throw new WalletError('chain-unavailable', 'the endpoint is not answering')
    }

    await renderWallet(chain)

    expect(await screen.findByTestId('wallet-error')).toHaveTextContent(/not answering/i)
    expect(screen.getByRole('heading', { name: 'Balance' })).toBeVisible()
  })

  it('condenses a raw provider dump instead of pasting it into the panel', async () => {
    const chain = new FakeChain()
    chain.getBalance = async () => {
      // The shape viem really throws: a headline, the request it sent and the
      // reason at the very bottom.
      throw new Error(
        'Transaction creation failed.\n\nURL: https://ethereum-sepolia-rpc.publicnode.com\n' +
          'Request body: {"method":"eth_estimateGas"}\n\nDetails: EVM error: OutOfFunds\n' +
          'Version: viem@2.56.9',
      )
    }

    await renderWallet(chain)

    const notice = await screen.findByTestId('wallet-error')
    expect(notice).toHaveTextContent(/does not hold enough Sepolia ETH/i)
    expect(notice.textContent).not.toContain('Request body')
    expect(notice.textContent).not.toContain('eth_estimateGas')
  })
})
