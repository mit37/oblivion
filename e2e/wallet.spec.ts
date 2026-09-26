import { expect, test, type Page } from '@playwright/test'

import stub from './stub-chain.json' with { type: 'json' }

/**
 * The wallet end to end, with the public Sepolia endpoint replaced by a canned
 * JSON-RPC server. viem, the chain guard, the fee maths and the UI are all real;
 * only the chain is fake, so CI never needs outbound network access.
 *
 * The gas numbers live in `stub-chain.json` because this test's assertion on the
 * fee and `scripts/report.mjs`'s row about it must not drift apart.
 */

const hex = (value: number): string => `0x${BigInt(value).toString(16)}`
const gwei = (value: number): string => `0x${(BigInt(value) * 10n ** 9n).toString(16)}`

const RPC_PATTERN = /ethereum-sepolia-rpc\.publicnode\.com/
const CHAIN_ID = '0xaa36a7' // 11155111
const BLOCK_NUMBER = '0x64' // 100
const SENT_HASH = `0x${'cd'.repeat(32)}`
const PASSWORD = 'correct horse battery staple'

interface RpcCall {
  readonly method: string
  readonly params: readonly unknown[]
}

interface StubState {
  /** The address the app asked about first: the vault's own account. */
  address: string
  sentRawTransactions: string[]
}

async function installRpcStub(page: Page): Promise<StubState> {
  const state: StubState = { address: '', sentRawTransactions: [] }

  await page.route(RPC_PATTERN, async (route) => {
    const call = route.request().postDataJSON() as RpcCall
    const result = await respond(call, state)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
    })
  })

  return state
}

async function respond(call: RpcCall, state: StubState): Promise<unknown> {
  switch (call.method) {
    case 'eth_chainId':
      return CHAIN_ID

    case 'eth_blockNumber':
      return BLOCK_NUMBER

    case 'eth_getBalance':
      state.address = String(call.params[0])
      return '0xde0b6b3a7640000' // 1 ETH

    case 'eth_getBlockByNumber':
      return block(Number.parseInt(String(call.params[0]), 16), state.address)

    case 'eth_estimateGas':
      return hex(stub.gasLimit)

    case 'eth_gasPrice':
      return gwei(stub.gasPriceGwei)

    case 'eth_getTransactionCount':
      return '0x0'

    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00' // 1 gwei

    // viem asks the node to fill in the gaps (nonce, fees, chain id) before it
    // signs locally, exactly as it would against a real endpoint.
    case 'eth_fillTransaction': {
      const request = (call.params[0] ?? {}) as Record<string, unknown>

      return {
        ...request,
        chainId: CHAIN_ID,
        gas: hex(stub.gasLimit),
        maxFeePerGas: gwei(stub.maxFeePerGasGwei),
        maxPriorityFeePerGas: '0x3b9aca00',
        nonce: '0x0',
        type: '0x2',
        value: typeof request.value === 'string' ? request.value : '0x0',
      }
    }

    case 'eth_sendRawTransaction':
      state.sentRawTransactions.push(String(call.params[0]))
      return SENT_HASH

    case 'eth_getTransactionReceipt':
      return String(call.params[0]) === SENT_HASH
        ? {
            transactionHash: SENT_HASH,
            status: '0x1',
            blockNumber: BLOCK_NUMBER,
            gasUsed: hex(stub.gasLimit),
            cumulativeGasUsed: hex(stub.gasLimit),
            logs: [],
            logsBloom: `0x${'00'.repeat(256)}`,
            transactionIndex: '0x0',
            blockHash: `0x${'11'.repeat(32)}`,
            contractAddress: null,
            effectiveGasPrice: gwei(stub.gasPriceGwei),
            type: '0x2',
          }
        : null

    default:
      throw new Error(`the stub does not answer ${call.method}`)
  }
}

/** One mined block: the app scans blocks for activity, so it must be well formed. */
function block(number: number, address: string): unknown {
  const hash = `0x${'11'.repeat(32)}`
  const transactionHash = `0x${'ab'.repeat(32)}`

  return {
    number: `0x${number.toString(16)}`,
    hash,
    parentHash: `0x${'22'.repeat(32)}`,
    nonce: '0x0000000000000042',
    sha3Uncles: `0x${'33'.repeat(32)}`,
    logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: `0x${'44'.repeat(32)}`,
    stateRoot: `0x${'55'.repeat(32)}`,
    receiptsRoot: `0x${'66'.repeat(32)}`,
    miner: `0x${'77'.repeat(20)}`,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x200',
    gasLimit: '0x1c9c380',
    gasUsed: hex(stub.gasLimit),
    baseFeePerGas: '0x3b9aca00',
    timestamp: '0x66f00000',
    uncles: [],
    // A transfer into the vault's own account, so the history scan has something real.
    transactions: [
      {
        hash: transactionHash,
        blockHash: hash,
        blockNumber: `0x${number.toString(16)}`,
        transactionIndex: '0x0',
        from: `0x${'88'.repeat(20)}`,
        to: address || null,
        value: '0x5af3107a4000', // 0.0001 ETH
        gas: hex(stub.gasLimit),
        gasPrice: gwei(stub.gasPriceGwei),
        maxFeePerGas: gwei(stub.gasPriceGwei),
        maxPriorityFeePerGas: '0x3b9aca00',
        nonce: '0x1',
        input: '0x',
        type: '0x2',
        chainId: '0xaa36a7',
        v: '0x1',
        r: `0x${'99'.repeat(32)}`,
        s: `0x${'aa'.repeat(32)}`,
      },
    ],
  }
}

async function createVault(page: Page): Promise<void> {
  await page.getByLabel('New password').fill(PASSWORD)
  await page.getByLabel('Repeat password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create vault' }).click()

  await expect(page.getByRole('heading', { name: 'Write down your recovery phrase' })).toBeVisible()

  const words = await page.locator('[data-testid="recovery-phrase"] .word-text').allTextContents()

  await page.getByRole('button', { name: 'I have written it down' }).click()
  await expect(page.getByRole('heading', { name: 'Confirm three words' })).toBeVisible()

  // The gate asks for three word positions; the phrase is on screen behind it.
  const fields = page.locator('label').filter({ hasText: 'Word #' })

  for (let index = 0; index < (await fields.count()); index += 1) {
    const field = fields.nth(index)
    const label = (await field.locator('span').first().textContent())?.trim() ?? ''
    const position = Number(label.replace('Word #', ''))

    await field.locator('input').fill(words[position - 1] ?? '')
  }

  await page.getByRole('button', { name: 'Confirm and open my vault' }).click()
  await expect(page.getByRole('heading', { name: 'Your identity' })).toBeVisible()
}

test('wallet: balances, sends and reads history over a stubbed Sepolia endpoint', async ({
  page,
}) => {
  test.setTimeout(180_000)

  const state = await installRpcStub(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Create your vault' })).toBeVisible()

  await createVault(page)

  // Balance and address, read through the real viem client.
  const wallet = page.getByRole('region', { name: 'Testnet wallet' })
  await expect(wallet.getByTestId('wallet-balance')).toHaveText('1 ETH')
  await expect(page.getByTestId('payment-uri')).toContainText('@11155111')

  // The history scan found the inbound transfer in the stub's block.
  await expect(page.getByTestId('history-list')).toContainText('Received')

  // A transfer, with the fee shown before anything is signed.
  await page.getByLabel('Recipient address or payment link').fill(`0x${'22'.repeat(20)}`)
  await page.getByLabel('Amount (ETH)').fill(stub.sendAmountEth)
  await page.getByRole('button', { name: 'Review transfer' }).click()

  const review = page.getByTestId('send-review')
  // Worst case: the gas limit at the capped fee (the numbers in stub-chain.json).
  await expect(review).toContainText(`${stub.worstCaseFeeEth} ETH`)
  await expect(review).toContainText(`${stub.totalRequiredEth} ETH`)

  await page.getByRole('button', { name: `Send ${stub.sendAmountEth} ETH` }).click()

  const sent = page.getByTestId('sent-transaction')
  await expect(sent).toContainText(SENT_HASH)
  await expect(sent.getByTestId('transaction-status')).toContainText('pending')
  expect(state.sentRawTransactions).toHaveLength(1)

  // The receipt turns it confirmed, which also triggers a fresh history scan.
  await page.getByRole('button', { name: 'Check status' }).click()
  await expect(sent.getByTestId('transaction-status')).toContainText('confirmed in block 100')
})
