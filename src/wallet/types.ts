import type { HexString } from '../crypto/keys'

/** ERC-20 metadata plus its address, as stored in the vault. */
export interface TokenInfo {
  readonly address: HexString
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

export interface TokenBalance {
  readonly token: TokenInfo
  readonly balanceWei: bigint
}

export type TransactionDirection = 'in' | 'out' | 'self'

export interface WalletTransaction {
  readonly hash: HexString
  readonly blockNumber: bigint
  readonly direction: TransactionDirection
  readonly from: HexString
  readonly to: HexString | null
  readonly valueWei: bigint
}

export interface TransactionStatus {
  readonly state: 'pending' | 'confirmed' | 'failed'
  readonly blockNumber: bigint | null
  readonly gasUsedWei: bigint | null
}

export interface FeeEstimate {
  readonly gas: bigint
  readonly maxFeePerGasWei: bigint
  readonly maxPriorityFeePerGasWei: bigint
  readonly estimatedFeeWei: bigint
  /** Value plus the worst-case fee: what the account must be able to cover. */
  readonly totalRequiredWei: bigint
}

export interface BlockTransactionLike {
  readonly hash: HexString
  readonly from: HexString
  readonly to: HexString | null
  readonly valueWei: bigint
}

export interface BlockLike {
  readonly number: bigint
  readonly transactions: readonly BlockTransactionLike[]
}

export interface ReceiptLike {
  readonly state: 'confirmed' | 'failed'
  readonly blockNumber: bigint | null
  readonly gasUsedWei: bigint
}

/**
 * The narrow slice of JSON-RPC this wallet needs. Production passes an adapter
 * over a viem public client; tests pass a fake, so no test touches the network.
 */
export interface ChainReader {
  getChainId(): Promise<number>
  getBalance(args: { address: HexString }): Promise<bigint>
  getGasPrice(): Promise<bigint>
  estimateGas(args: { account: HexString; to: HexString; valueWei: bigint }): Promise<bigint>
  getBlockNumber(): Promise<bigint>
  getBlock(args: { blockNumber: bigint }): Promise<BlockLike | null>
  getTransactionReceipt(args: { hash: HexString }): Promise<ReceiptLike | null>
  readTokenMetadata(args: { token: HexString }): Promise<TokenInfo>
  readTokenBalance(args: { token: HexString; owner: HexString }): Promise<bigint>
}

/** The signing side. Production wraps a viem wallet client; tests fake it. */
export interface ChainSender {
  sendTransaction(args: {
    to: HexString
    valueWei: bigint
    gas: bigint
    maxFeePerGasWei: bigint
    maxPriorityFeePerGasWei: bigint
  }): Promise<HexString>
}
