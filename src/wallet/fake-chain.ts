/**
 * In-memory chain double.
 *
 * Used by the wallet tests (so no test ever touches the network) and available
 * to the mock/demo mode. It records the order of calls so tests can assert that
 * the chain guard runs before anything else.
 */
import type { HexString } from '../crypto/keys'
import { SEPOLIA_CHAIN_ID } from './chain'
import type {
  BlockLike,
  ChainReader,
  ChainSender,
  ReceiptLike,
  TokenInfo,
  WalletTransaction,
} from './types'

export interface FakeChainOptions {
  readonly chainId?: number
  readonly balanceWei?: bigint
  readonly gasPriceWei?: bigint
  readonly gasEstimate?: bigint
  readonly latestBlock?: bigint
  /** Block number (as a string) → block contents. Missing blocks read as null. */
  readonly blocks?: Record<string, BlockLike>
  readonly receipts?: Record<string, ReceiptLike>
  readonly tokens?: Record<string, { info: TokenInfo; balanceWei: bigint }>
  readonly failWith?: Error
}

export class FakeChain implements ChainReader {
  readonly calls: string[] = []

  constructor(private readonly options: FakeChainOptions = {}) {}

  get chainId(): number {
    return this.options.chainId ?? SEPOLIA_CHAIN_ID
  }

  async getChainId(): Promise<number> {
    this.calls.push('getChainId')
    return this.chainId
  }

  async getBalance(): Promise<bigint> {
    this.calls.push('getBalance')
    return this.options.balanceWei ?? 0n
  }

  async getGasPrice(): Promise<bigint> {
    this.calls.push('getGasPrice')
    return this.options.gasPriceWei ?? 10_000_000_000n
  }

  async estimateGas(): Promise<bigint> {
    this.calls.push('estimateGas')
    return this.options.gasEstimate ?? 21_000n
  }

  async getBlockNumber(): Promise<bigint> {
    this.calls.push('getBlockNumber')
    return this.options.latestBlock ?? 0n
  }

  async getBlock(args: { blockNumber: bigint }): Promise<BlockLike | null> {
    this.calls.push(`getBlock:${args.blockNumber}`)
    return this.options.blocks?.[args.blockNumber.toString()] ?? null
  }

  async getTransactionReceipt(args: { hash: HexString }): Promise<ReceiptLike | null> {
    this.calls.push(`getTransactionReceipt:${args.hash}`)
    return this.options.receipts?.[args.hash] ?? null
  }

  async readTokenMetadata(args: { token: HexString }): Promise<TokenInfo> {
    this.calls.push(`readTokenMetadata:${args.token}`)

    const token = this.options.tokens?.[args.token]
    if (!token) throw new Error(`no fake token registered for ${args.token}`)

    return token.info
  }

  async readTokenBalance(args: { token: HexString; owner: HexString }): Promise<bigint> {
    this.calls.push(`readTokenBalance:${args.token}`)

    const token = this.options.tokens?.[args.token]
    if (!token) throw new Error(`no fake token registered for ${args.token}`)

    return token.balanceWei
  }
}

export interface FakeSender extends ChainSender {
  readonly sent: Array<{
    to: HexString
    valueWei: bigint
    gas: bigint
    maxFeePerGasWei: bigint
    maxPriorityFeePerGasWei: bigint
  }>
}

/** Signing double: records what would have been broadcast. */
export function createFakeSender(options: { hash?: HexString; error?: Error } = {}): FakeSender {
  const sent: FakeSender['sent'] = []

  return {
    sent,
    async sendTransaction(args) {
      sent.push(args)

      if (options.error) throw options.error

      return options.hash ?? `0x${'ab'.repeat(32)}`
    },
  }
}

export function blockWith(number: bigint, transactions: BlockLike['transactions']): BlockLike {
  return { number, transactions }
}

export function transaction(
  hash: string,
  from: string,
  to: string | null,
  valueWei: bigint,
): WalletTransaction {
  return {
    hash: hash as HexString,
    blockNumber: 0n,
    direction: 'out',
    from: from as HexString,
    to: to === null ? null : (to as HexString),
    valueWei,
  }
}
