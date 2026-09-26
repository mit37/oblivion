/**
 * Sepolia-only chain policy (PRD §2).
 *
 * The chain id is hard-coded, mainnet is refused by the code rather than by
 * convention, and a test enforces the refusal.
 */
export const SEPOLIA_CHAIN_ID = 11_155_111
export const MAINNET_CHAIN_ID = 1
export const SEPOLIA_CHAIN_NAME = 'Sepolia'
export const SEPOLIA_EXPLORER_URL = 'https://sepolia.etherscan.io'

/** Public endpoint that needs no API key; can be overridden per environment. */
export const DEFAULT_SEPOLIA_RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'

export const NATIVE_CURRENCY_SYMBOL = 'ETH'

export type WalletErrorCode =
  | 'mainnet-refused'
  | 'unsupported-chain'
  | 'invalid-address'
  | 'invalid-amount'
  | 'insufficient-funds'
  | 'invalid-rpc-url'
  | 'chain-unavailable'

export class WalletError extends Error {
  readonly code: WalletErrorCode

  constructor(code: WalletErrorCode, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** The wallet was pointed at mainnet. This is the one thing v2 never does. */
export class MainnetRefusedError extends WalletError {
  constructor(
    message = 'Oblivion refuses to use Ethereum mainnet; this prototype is Sepolia-only',
  ) {
    super('mainnet-refused', message)
  }
}

/** Any chain that is neither Sepolia nor mainnet. */
export class UnsupportedChainError extends WalletError {
  constructor(chainId: number) {
    super('unsupported-chain', `unsupported chain id ${chainId}; Oblivion only talks to Sepolia`)
  }
}

export class InsufficientFundsError extends WalletError {
  constructor(message: string) {
    super('insufficient-funds', message)
  }
}

export class InvalidRpcUrlError extends WalletError {
  constructor(message: string) {
    super('invalid-rpc-url', message)
  }
}

/**
 * Throws unless `chainId` is Sepolia. Mainnet gets its own error so the refusal
 * is explicit in logs and tests rather than a generic rejection.
 */
export function assertSepoliaChainId(chainId: number): void {
  if (chainId === MAINNET_CHAIN_ID) {
    throw new MainnetRefusedError()
  }

  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new UnsupportedChainError(chainId)
  }
}

export function isSepolia(chainId: number): boolean {
  return chainId === SEPOLIA_CHAIN_ID
}

/**
 * Resolves the RPC endpoint: an explicit value wins, then the build-time
 * environment variable, then the public default. Only http(s) is accepted, so a
 * typo cannot turn into an unexpected protocol.
 */
export function resolveRpcUrl(explicit?: string): string {
  const configured = explicit ?? readConfiguredRpcUrl() ?? DEFAULT_SEPOLIA_RPC_URL
  return assertHttpUrl(configured)
}

export function assertHttpUrl(value: string): string {
  let parsed: URL

  try {
    parsed = new URL(value)
  } catch {
    throw new InvalidRpcUrlError('RPC endpoint must be an absolute http(s) URL')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new InvalidRpcUrlError(`RPC endpoint must use http(s), received "${parsed.protocol}"`)
  }

  return value
}

function readConfiguredRpcUrl(): string | undefined {
  const value = import.meta.env?.VITE_SEPOLIA_RPC_URL
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function explorerTransactionUrl(hash: string): string {
  return `${SEPOLIA_EXPLORER_URL}/tx/${hash}`
}

export function explorerAddressUrl(address: string): string {
  return `${SEPOLIA_EXPLORER_URL}/address/${address}`
}
