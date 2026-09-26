import type { HexString } from '../crypto/keys'
import { InsufficientFundsError, assertSepoliaChainId, resolveRpcUrl, WalletError } from './chain'
import { assertAddress as assertWalletAddress } from './format'
import type {
  ChainReader,
  ChainSender,
  FeeEstimate,
  TokenBalance,
  TokenInfo,
  TransactionDirection,
  TransactionStatus,
  WalletTransaction,
} from './types'

/** How many recent blocks a history refresh scans by default. */
export const DEFAULT_HISTORY_LOOKBACK_BLOCKS = 12
export const MAX_HISTORY_LOOKBACK_BLOCKS = 512

/** Priority fee used when the endpoint does not suggest one. */
export const DEFAULT_PRIORITY_FEE_WEI = 1_000_000_000n

export interface WalletServiceOptions {
  readonly reader: ChainReader
  /** Absent in read-only mode (no key in memory): sending then reports a clear error. */
  readonly sender?: ChainSender
  readonly rpcUrl?: string
}

export interface SendRequest {
  readonly from: HexString
  readonly to: HexString
  readonly valueWei: bigint
}

export interface SendPlan extends SendRequest {
  readonly fee: FeeEstimate
}

export interface HistoryQuery {
  readonly address: HexString
  readonly lookbackBlocks?: number
}

/**
 * Everything the wallet UI needs, over a narrow reader interface so tests can
 * fake the chain. Every method that touches the chain checks the chain id
 * first: an endpoint that is not Sepolia is refused, not used.
 */
export class WalletService {
  private readonly reader: ChainReader
  private readonly sender: ChainSender | undefined
  readonly rpcUrl: string

  constructor(options: WalletServiceOptions) {
    this.reader = options.reader
    this.sender = options.sender
    this.rpcUrl = resolveRpcUrl(options.rpcUrl)
  }

  get canSend(): boolean {
    return this.sender !== undefined
  }

  /** Confirms the endpoint is Sepolia; throws for mainnet and for anything else. */
  async assertChain(): Promise<number> {
    const chainId = await this.reader.getChainId()
    assertSepoliaChainId(chainId)
    return chainId
  }

  async getBalance(address: string): Promise<bigint> {
    await this.assertChain()
    return this.reader.getBalance({ address: assertWalletAddress(address, 'balance address') })
  }

  async estimateSend(request: SendRequest): Promise<FeeEstimate> {
    await this.assertChain()

    const from = assertWalletAddress(request.from, 'sender')
    const to = assertWalletAddress(request.to, 'recipient')

    if (request.valueWei <= 0n) {
      throw new WalletError('invalid-amount', 'amount must be greater than zero')
    }

    const gas = await this.reader.estimateGas({ account: from, to, valueWei: request.valueWei })
    const gasPrice = await this.reader.getGasPrice()

    // Doubling the current gas price absorbs base-fee movement between estimate
    // and inclusion without pretending to predict it.
    const maxFeePerGasWei = gasPrice * 2n
    const maxPriorityFeePerGasWei =
      gasPrice > DEFAULT_PRIORITY_FEE_WEI ? DEFAULT_PRIORITY_FEE_WEI : gasPrice / 2n
    const estimatedFeeWei = gas * maxFeePerGasWei

    return {
      gas,
      maxFeePerGasWei,
      maxPriorityFeePerGasWei,
      estimatedFeeWei,
      totalRequiredWei: request.valueWei + estimatedFeeWei,
    }
  }

  /**
   * Estimates, checks the balance covers value + worst-case fee, then signs and
   * broadcasts. Returns the transaction hash.
   */
  async send(request: SendRequest): Promise<{ hash: HexString; fee: FeeEstimate }> {
    if (!this.sender) {
      throw new WalletError('chain-unavailable', 'this session is read-only: the vault is locked')
    }

    const fee = await this.estimateSend(request)
    const balance = await this.getBalance(request.from)

    if (balance < fee.totalRequiredWei) {
      throw new InsufficientFundsError(
        'the amount plus the estimated fee is beyond what this address holds on Sepolia',
      )
    }

    const hash = await this.sender.sendTransaction({
      to: assertWalletAddress(request.to, 'recipient'),
      valueWei: request.valueWei,
      gas: fee.gas,
      maxFeePerGasWei: fee.maxFeePerGasWei,
      maxPriorityFeePerGasWei: fee.maxPriorityFeePerGasWei,
    })

    return { hash, fee }
  }

  /**
   * Recent activity for an address, from a bounded block scan plus the wallet's
   * own records. There is no indexer, so older history is out of scope and the
   * README says so.
   */
  async getHistory(query: HistoryQuery): Promise<WalletTransaction[]> {
    await this.assertChain()

    const address = assertWalletAddress(query.address, 'history address')
    const lookback = clampLookback(query.lookbackBlocks)
    const latest = await this.reader.getBlockNumber()
    const found: WalletTransaction[] = []

    for (let offset = 0; offset < lookback; offset += 1) {
      const blockNumber = latest - BigInt(offset)
      if (blockNumber < 0n) break

      const block = await this.reader.getBlock({ blockNumber })
      if (!block) continue

      for (const transaction of block.transactions) {
        const direction = classifyDirection(address, transaction.from, transaction.to)
        if (!direction) continue

        found.push({
          hash: transaction.hash,
          blockNumber: block.number,
          direction,
          from: transaction.from,
          to: transaction.to,
          valueWei: transaction.valueWei,
        })
      }
    }

    return found.sort((left, right) => Number(right.blockNumber - left.blockNumber))
  }

  async getTransactionStatus(hash: string): Promise<TransactionStatus> {
    await this.assertChain()

    const receipt = await this.reader.getTransactionReceipt({ hash: assertTransactionHash(hash) })

    if (!receipt) {
      return { state: 'pending', blockNumber: null, gasUsedWei: null }
    }

    return {
      state: receipt.state,
      blockNumber: receipt.blockNumber,
      gasUsedWei: receipt.gasUsedWei,
    }
  }

  /** Reads name/symbol/decimals so a pasted token address can be added safely. */
  async loadToken(address: string): Promise<TokenInfo> {
    await this.assertChain()
    return this.reader.readTokenMetadata({
      token: assertWalletAddress(address, 'token address'),
    })
  }

  async getTokenBalances(owner: string, tokens: readonly TokenInfo[]): Promise<TokenBalance[]> {
    await this.assertChain()

    const holder = assertWalletAddress(owner, 'token owner')

    return Promise.all(
      tokens.map(async (token) => ({
        token,
        balanceWei: await this.reader.readTokenBalance({ token: token.address, owner: holder }),
      })),
    )
  }
}

function assertTransactionHash(value: string): HexString {
  const trimmed = value.trim()

  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new WalletError('invalid-address', 'transaction hash must be 32 bytes of hex')
  }

  return trimmed as HexString
}

function clampLookback(lookbackBlocks: number | undefined): number {
  if (lookbackBlocks === undefined || !Number.isFinite(lookbackBlocks)) {
    return DEFAULT_HISTORY_LOOKBACK_BLOCKS
  }

  return Math.max(1, Math.min(Math.floor(lookbackBlocks), MAX_HISTORY_LOOKBACK_BLOCKS))
}

function classifyDirection(
  address: HexString,
  from: HexString,
  to: HexString | null,
): TransactionDirection | null {
  const self = address.toLowerCase()
  const sender = from.toLowerCase()
  const recipient = to?.toLowerCase() ?? null

  if (sender === self && recipient === self) return 'self'
  if (sender === self) return 'out'
  if (recipient === self) return 'in'
  return null
}
