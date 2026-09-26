import { describe, expect, it } from 'vitest'

import type { HexString } from '../crypto/keys'
import {
  DEFAULT_HISTORY_LOOKBACK_BLOCKS,
  DEFAULT_PRIORITY_FEE_WEI,
  MAX_HISTORY_LOOKBACK_BLOCKS,
  WalletService,
} from './service'
import {
  MAINNET_CHAIN_ID,
  MainnetRefusedError,
  SEPOLIA_CHAIN_ID,
  UnsupportedChainError,
  WalletError,
} from './chain'
import { FakeChain, blockWith, createFakeSender } from './fake-chain'
import type { TokenInfo } from './types'

const ADDRESS = '0x1111111111111111111111111111111111111111' as HexString
const OTHER = '0x2222222222222222222222222222222222222222' as HexString
const TOKEN = '0x3333333333333333333333333333333333333333' as HexString

const HASH_OUT = `0x${'aa'.repeat(32)}` as HexString
const HASH_IN = `0x${'bb'.repeat(32)}` as HexString
const HASH_SELF = `0x${'cc'.repeat(32)}` as HexString
const HASH_OTHER = `0x${'dd'.repeat(32)}` as HexString

const ONE_ETH = 1_000_000_000_000_000_000n
const TEN_GWEI = 10_000_000_000n

const TOKEN_INFO: TokenInfo = {
  address: TOKEN,
  name: 'Test USD',
  symbol: 'TUSD',
  decimals: 6,
}

function serviceWith(chain: FakeChain, sender = createFakeSender()) {
  return { service: new WalletService({ reader: chain, sender }), sender }
}

describe('chain guard on every call', () => {
  it('accepts Sepolia and returns its id', async () => {
    expect(await new WalletService({ reader: new FakeChain() }).assertChain()).toBe(
      SEPOLIA_CHAIN_ID,
    )
  })

  it('refuses mainnet before reading a balance', async () => {
    const service = new WalletService({ reader: new FakeChain({ chainId: MAINNET_CHAIN_ID }) })
    await expect(service.getBalance(ADDRESS)).rejects.toThrow(MainnetRefusedError)
  })

  it('refuses mainnet before estimating a send', async () => {
    const service = new WalletService({ reader: new FakeChain({ chainId: MAINNET_CHAIN_ID }) })
    await expect(service.estimateSend({ from: ADDRESS, to: OTHER, valueWei: 1n })).rejects.toThrow(
      MainnetRefusedError,
    )
  })

  it('refuses mainnet before reading history', async () => {
    const service = new WalletService({ reader: new FakeChain({ chainId: MAINNET_CHAIN_ID }) })
    await expect(service.getHistory({ address: ADDRESS })).rejects.toThrow(MainnetRefusedError)
  })

  it('refuses mainnet before reading a token', async () => {
    const service = new WalletService({ reader: new FakeChain({ chainId: MAINNET_CHAIN_ID }) })
    await expect(service.loadToken(TOKEN)).rejects.toThrow(MainnetRefusedError)
  })

  it('refuses an unrelated chain', async () => {
    const service = new WalletService({ reader: new FakeChain({ chainId: 8453 }) })
    await expect(service.getBalance(ADDRESS)).rejects.toThrow(UnsupportedChainError)
  })

  it('checks the chain id before touching anything else', async () => {
    const chain = new FakeChain()
    await new WalletService({ reader: chain }).getBalance(ADDRESS)
    expect(chain.calls[0]).toBe('getChainId')
  })
})

describe('balances', () => {
  it('returns the balance for an address', async () => {
    const service = new WalletService({ reader: new FakeChain({ balanceWei: ONE_ETH }) })
    expect(await service.getBalance(ADDRESS)).toBe(ONE_ETH)
  })

  it('rejects a malformed address', async () => {
    const service = new WalletService({ reader: new FakeChain() })
    await expect(service.getBalance('0x1234')).rejects.toThrow(WalletError)
  })
})

describe('fee estimation', () => {
  it('doubles the gas price for the max fee and caps the priority fee', async () => {
    const service = new WalletService({ reader: new FakeChain({ gasPriceWei: TEN_GWEI }) })
    const fee = await service.estimateSend({ from: ADDRESS, to: OTHER, valueWei: 1_000n })

    expect(fee.gas).toBe(21_000n)
    expect(fee.maxFeePerGasWei).toBe(TEN_GWEI * 2n)
    expect(fee.maxPriorityFeePerGasWei).toBe(DEFAULT_PRIORITY_FEE_WEI)
    expect(fee.estimatedFeeWei).toBe(21_000n * TEN_GWEI * 2n)
    expect(fee.totalRequiredWei).toBe(fee.estimatedFeeWei + 1_000n)
  })

  it('halves a gas price below the priority fee floor', async () => {
    const service = new WalletService({ reader: new FakeChain({ gasPriceWei: 1_000_000_000n }) })
    const fee = await service.estimateSend({ from: ADDRESS, to: OTHER, valueWei: 1n })

    expect(fee.maxPriorityFeePerGasWei).toBe(500_000_000n)
  })

  it('rejects a zero amount', async () => {
    const service = new WalletService({ reader: new FakeChain() })
    await expect(service.estimateSend({ from: ADDRESS, to: OTHER, valueWei: 0n })).rejects.toThrow(
      WalletError,
    )
  })

  it('rejects a malformed recipient', async () => {
    const service = new WalletService({ reader: new FakeChain() })
    await expect(
      service.estimateSend({ from: ADDRESS, to: 'nope' as HexString, valueWei: 1n }),
    ).rejects.toThrow(WalletError)
  })
})

describe('sending', () => {
  it('estimates, checks the balance and broadcasts', async () => {
    const chain = new FakeChain({ balanceWei: ONE_ETH, gasPriceWei: TEN_GWEI })
    const { service, sender } = serviceWith(chain)

    const result = await service.send({ from: ADDRESS, to: OTHER, valueWei: 1_000n })

    expect(result.hash).toBe(`0x${'ab'.repeat(32)}`)
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]).toMatchObject({
      to: OTHER,
      valueWei: 1_000n,
      gas: 21_000n,
      maxFeePerGasWei: TEN_GWEI * 2n,
    })
  })

  it('refuses when the balance cannot cover value plus the fee', async () => {
    const chain = new FakeChain({ balanceWei: 1_000n, gasPriceWei: TEN_GWEI })
    const { service, sender } = serviceWith(chain)

    await expect(service.send({ from: ADDRESS, to: OTHER, valueWei: 1_000n })).rejects.toThrow(
      /beyond what this address holds/,
    )
    expect(sender.sent).toHaveLength(0)
  })

  it('sends when the balance covers the amount exactly', async () => {
    const feeTotal = 21_000n * TEN_GWEI * 2n
    const chain = new FakeChain({ balanceWei: feeTotal + 1_000n, gasPriceWei: TEN_GWEI })
    const { service, sender } = serviceWith(chain)

    await service.send({ from: ADDRESS, to: OTHER, valueWei: 1_000n })
    expect(sender.sent).toHaveLength(1)
  })

  it('refuses to send in read-only mode', async () => {
    const service = new WalletService({ reader: new FakeChain({ balanceWei: ONE_ETH }) })

    expect(service.canSend).toBe(false)
    await expect(service.send({ from: ADDRESS, to: OTHER, valueWei: 1n })).rejects.toThrow(
      /read-only/,
    )
  })

  it('refuses to send to mainnet', async () => {
    const chain = new FakeChain({ chainId: MAINNET_CHAIN_ID, balanceWei: ONE_ETH })
    const { service, sender } = serviceWith(chain)

    await expect(service.send({ from: ADDRESS, to: OTHER, valueWei: 1n })).rejects.toThrow(
      MainnetRefusedError,
    )
    expect(sender.sent).toHaveLength(0)
  })

  it('reports that sending is possible when a sender is present', () => {
    const { service } = serviceWith(new FakeChain())
    expect(service.canSend).toBe(true)
  })
})

describe('history', () => {
  function historyChain(latestBlock = 100n) {
    return new FakeChain({
      latestBlock,
      blocks: {
        '100': blockWith(100n, [
          { hash: HASH_OUT, from: ADDRESS, to: OTHER, valueWei: 1_000n },
          { hash: HASH_OTHER, from: OTHER, to: OTHER, valueWei: 5_000n },
        ]),
        '99': blockWith(99n, [{ hash: HASH_IN, from: OTHER, to: ADDRESS, valueWei: 2_000n }]),
        '98': blockWith(98n, [{ hash: HASH_SELF, from: ADDRESS, to: ADDRESS, valueWei: 3_000n }]),
      },
    })
  }

  it('returns only this address, newest first, with a direction', async () => {
    const service = new WalletService({ reader: historyChain() })
    const history = await service.getHistory({ address: ADDRESS, lookbackBlocks: 3 })

    expect(history.map((entry) => entry.hash)).toEqual([HASH_OUT, HASH_IN, HASH_SELF])
    expect(history.map((entry) => entry.direction)).toEqual(['out', 'in', 'self'])
  })

  it('matches addresses regardless of case', async () => {
    const service = new WalletService({ reader: historyChain() })
    const history = await service.getHistory({
      address: ADDRESS.toUpperCase().replace('0X', '0x') as HexString,
      lookbackBlocks: 3,
    })

    expect(history).toHaveLength(3)
  })

  it('defaults to a bounded scan', async () => {
    const chain = historyChain(1_000n)
    await new WalletService({ reader: chain }).getHistory({ address: ADDRESS })

    const blockCalls = chain.calls.filter((call) => call.startsWith('getBlock:'))
    expect(blockCalls).toHaveLength(DEFAULT_HISTORY_LOOKBACK_BLOCKS)
  })

  it('clamps a zero lookback to one block', async () => {
    const chain = historyChain()
    await new WalletService({ reader: chain }).getHistory({ address: ADDRESS, lookbackBlocks: 0 })

    expect(chain.calls.filter((call) => call.startsWith('getBlock:'))).toEqual(['getBlock:100'])
  })

  it('clamps a huge lookback to the maximum', async () => {
    const chain = historyChain(10_000n)
    await new WalletService({ reader: chain }).getHistory({ address: ADDRESS, lookbackBlocks: 1e9 })

    expect(chain.calls.filter((call) => call.startsWith('getBlock:'))).toHaveLength(
      MAX_HISTORY_LOOKBACK_BLOCKS,
    )
  })

  it('never asks for a negative block number', async () => {
    const chain = historyChain(1n)
    await new WalletService({ reader: chain }).getHistory({ address: ADDRESS, lookbackBlocks: 10 })

    expect(chain.calls.some((call) => call.includes('-'))).toBe(false)
  })

  it('skips blocks the endpoint does not return', async () => {
    const chain = new FakeChain({ latestBlock: 100n })
    const history = await new WalletService({ reader: chain }).getHistory({
      address: ADDRESS,
      lookbackBlocks: 3,
    })

    expect(history).toEqual([])
  })

  it('rejects a malformed address', async () => {
    const service = new WalletService({ reader: historyChain() })
    await expect(service.getHistory({ address: 'nope' as HexString })).rejects.toThrow(WalletError)
  })
})

describe('transaction status', () => {
  it('reports a confirmed transaction with gas used', async () => {
    const chain = new FakeChain({
      receipts: { [HASH_OUT]: { state: 'confirmed', blockNumber: 100n, gasUsedWei: 21_000n } },
    })
    const service = new WalletService({ reader: chain })

    expect(await service.getTransactionStatus(HASH_OUT)).toEqual({
      state: 'confirmed',
      blockNumber: 100n,
      gasUsedWei: 21_000n,
    })
  })

  it('reports a failed transaction', async () => {
    const chain = new FakeChain({
      receipts: { [HASH_OUT]: { state: 'failed', blockNumber: 100n, gasUsedWei: 21_000n } },
    })
    const service = new WalletService({ reader: chain })

    expect((await service.getTransactionStatus(HASH_OUT)).state).toBe('failed')
  })

  it('reports a transaction with no receipt yet as pending', async () => {
    const service = new WalletService({ reader: new FakeChain() })
    expect(await service.getTransactionStatus(HASH_OUT)).toEqual({
      state: 'pending',
      blockNumber: null,
      gasUsedWei: null,
    })
  })

  it('rejects a malformed hash', async () => {
    const service = new WalletService({ reader: new FakeChain() })
    await expect(service.getTransactionStatus('0xdeadbeef')).rejects.toThrow(WalletError)
  })
})

describe('tokens', () => {
  function tokenChain() {
    return new FakeChain({ tokens: { [TOKEN]: { info: TOKEN_INFO, balanceWei: 1_500_000n } } })
  }

  it('loads metadata for a pasted token address', async () => {
    const service = new WalletService({ reader: tokenChain() })
    expect(await service.loadToken(TOKEN)).toEqual(TOKEN_INFO)
  })

  it('rejects a malformed token address', async () => {
    const service = new WalletService({ reader: tokenChain() })
    await expect(service.loadToken('0xzz')).rejects.toThrow(WalletError)
  })

  it('reads balances for a list of tokens, in order', async () => {
    const service = new WalletService({ reader: tokenChain() })
    const balances = await service.getTokenBalances(ADDRESS, [TOKEN_INFO])

    expect(balances).toHaveLength(1)
    expect(balances[0]?.balanceWei).toBe(1_500_000n)
    expect(balances[0]?.token.symbol).toBe('TUSD')
  })

  it('returns an empty list for no tokens', async () => {
    const service = new WalletService({ reader: tokenChain() })
    expect(await service.getTokenBalances(ADDRESS, [])).toEqual([])
  })
})

describe('rpc configuration', () => {
  it('exposes the resolved endpoint', () => {
    const service = new WalletService({
      reader: new FakeChain(),
      rpcUrl: 'https://sepolia.example.org',
    })
    expect(service.rpcUrl).toBe('https://sepolia.example.org')
  })

  it('falls back to the default endpoint', () => {
    const service = new WalletService({ reader: new FakeChain() })
    expect(service.rpcUrl).toMatch(/^https:\/\//)
  })

  it('rejects an unusable endpoint', () => {
    expect(
      () => new WalletService({ reader: new FakeChain(), rpcUrl: 'sepolia.example.org' }),
    ).toThrow(WalletError)
  })
})
