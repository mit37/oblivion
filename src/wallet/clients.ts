import { createPublicClient, createWalletClient, erc20Abi, http, type PublicClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

import type { HexString } from '../crypto/keys'
import { DEFAULT_SEPOLIA_RPC_URL, resolveRpcUrl } from './chain'
import type { BlockLike, ChainReader, ChainSender, ReceiptLike, TokenInfo } from './types'

/** Read-only Sepolia client. The endpoint is configurable and needs no key. */
export function createSepoliaPublicClient(rpcUrl: string = resolveRpcUrl()): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
}

/** Signing client. The private key comes from the unlocked vault and never lands. */
export function createSepoliaWalletClient(
  privateKey: HexString,
  rpcUrl: string = resolveRpcUrl(),
): ReturnType<typeof createWalletClient> {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: sepolia,
    transport: http(rpcUrl),
  })
}

/**
 * Adapts a viem public client to the narrow `ChainReader` the wallet uses.
 * The mapping is deliberately explicit: blocks are normalised here so the rest
 * of the app never depends on viem's union types.
 */
export function toChainReader(client: PublicClient): ChainReader {
  return {
    getChainId: () => client.getChainId(),

    getBalance: ({ address }) => client.getBalance({ address }),

    getGasPrice: () => client.getGasPrice(),

    estimateGas: ({ account, to, valueWei }) =>
      client.estimateGas({ account, to, value: valueWei }),

    getBlockNumber: () => client.getBlockNumber(),

    getBlock: async ({ blockNumber }) => {
      const block = (await client.getBlock({
        blockNumber,
        includeTransactions: true,
      })) as unknown as { number: bigint | null; transactions: readonly unknown[] }

      return normalizeBlock(block)
    },

    getTransactionReceipt: async ({ hash }) => {
      const receipt = await client.getTransactionReceipt({ hash }).catch(() => null)
      if (!receipt) return null

      return {
        state: receipt.status === 'success' ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsedWei: receipt.gasUsed,
      } satisfies ReceiptLike
    },

    readTokenMetadata: async ({ token }) => {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
        client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      ])

      return {
        address: token,
        name: String(name),
        symbol: String(symbol),
        decimals: Number(decimals),
      } satisfies TokenInfo
    },

    readTokenBalance: async ({ token, owner }) => {
      const balance = await client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      })

      return BigInt(balance)
    },
  }
}

/** Adapts a viem wallet client to the narrow `ChainSender` interface. */
export function toChainSender(client: ReturnType<typeof createWalletClient>): ChainSender {
  return {
    sendTransaction: async ({ to, valueWei, gas, maxFeePerGasWei, maxPriorityFeePerGasWei }) => {
      const hash = await client.sendTransaction({
        account: client.account ?? null,
        chain: sepolia,
        to,
        value: valueWei,
        gas,
        maxFeePerGas: maxFeePerGasWei,
        maxPriorityFeePerGas: maxPriorityFeePerGasWei,
      })

      return hash as HexString
    },
  }
}

function normalizeBlock(block: {
  number: bigint | null
  transactions: readonly unknown[]
}): BlockLike | null {
  if (block.number === null) return null

  const transactions = block.transactions.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []

    const candidate = entry as {
      hash?: unknown
      from?: unknown
      to?: unknown
      value?: unknown
    }

    if (typeof candidate.hash !== 'string' || typeof candidate.from !== 'string') return []

    return [
      {
        hash: candidate.hash as HexString,
        from: candidate.from as HexString,
        to: typeof candidate.to === 'string' ? (candidate.to as HexString) : null,
        valueWei: typeof candidate.value === 'bigint' ? candidate.value : 0n,
      },
    ]
  })

  return { number: block.number, transactions }
}

export { DEFAULT_SEPOLIA_RPC_URL }
