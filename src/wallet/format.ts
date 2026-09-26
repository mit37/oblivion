import { formatEther, formatUnits, isAddress, parseEther, parseUnits } from 'viem'

import type { HexString } from '../crypto/keys'
import { SEPOLIA_CHAIN_ID, WalletError } from './chain'
import type { TokenInfo } from './types'

/** `0x1234…abcd` — for tables and buttons, never for copying. */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

export function assertAddress(value: string, label = 'address'): HexString {
  const trimmed = value.trim()

  if (!isAddress(trimmed, { strict: false })) {
    throw new WalletError('invalid-address', `${label} is not a valid 20-byte address`)
  }

  return trimmed as HexString
}

/** Human-readable ETH, e.g. `0.0015`. */
export function formatEth(wei: bigint, options: { maxDecimals?: number } = {}): string {
  const text = formatEther(wei)
  const maxDecimals = options.maxDecimals

  if (maxDecimals === undefined) return text

  const [whole = '0', fraction = ''] = text.split('.')
  if (fraction.length <= maxDecimals) return text

  const trimmed = fraction.slice(0, maxDecimals).replace(/0+$/, '')
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole
}

export function parseEthInput(value: string): bigint {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    throw new WalletError('invalid-amount', 'enter an amount to send')
  }

  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    throw new WalletError('invalid-amount', 'amount must be a plain decimal number of ETH')
  }

  // Conversion rounds to wei precision, so anything smaller than a wei becomes
  // zero and is rejected rather than broadcast as a no-op transfer.
  const parsed = parseEther(trimmed as `${number}`)

  if (parsed <= 0n) {
    throw new WalletError('invalid-amount', 'amount must be at least 1 wei')
  }

  return parsed
}

export function formatTokenAmount(
  amount: bigint,
  token: Pick<TokenInfo, 'decimals' | 'symbol'>,
): string {
  return `${formatUnits(amount, token.decimals)} ${token.symbol}`
}

/** Parses a token amount, rounding to the token's `decimals` like viem does. */
export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim()

  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    throw new WalletError('invalid-amount', 'amount must be a plain decimal number')
  }

  const parsed = parseUnits(trimmed as `${number}`, decimals)

  if (parsed <= 0n) {
    throw new WalletError('invalid-amount', 'amount must be at least one token unit')
  }

  return parsed
}

/**
 * EIP-681 payment URI, which is what the receive QR encodes:
 * `ethereum:<address>@11155111?value=<wei>` (plus `?token=` fields when the
 * amount is in an ERC-20).
 */
export function ethereumPaymentUri(
  address: HexString,
  options: { valueWei?: bigint; tokenAddress?: HexString } = {},
): string {
  const query = new URLSearchParams()

  if (options.valueWei !== undefined && options.valueWei > 0n) {
    query.set('value', options.valueWei.toString())
  }

  if (options.tokenAddress) {
    query.set('token', options.tokenAddress.toLowerCase())
  }

  const base = `ethereum:${address.toLowerCase()}@${SEPOLIA_CHAIN_ID}`
  const queryString = query.toString()

  return queryString.length > 0 ? `${base}?${queryString}` : base
}

/**
 * What the Send form needs from its two inputs: a recipient address, or a
 * payment link that already carries the amount. A link without an amount falls
 * back to whatever was typed, so a pasted link is never sent as zero.
 */
export function resolveTransferRequest(
  recipient: string,
  amount: string,
): { to: HexString; valueWei: bigint } {
  const target = recipient.trim()

  if (target.length === 0) {
    throw new WalletError('invalid-address', 'enter a recipient address or payment link')
  }

  if (target.toLowerCase().startsWith('ethereum:')) {
    const parsed = parseEthereumPaymentUri(target)

    if (parsed.tokenAddress) {
      throw new WalletError(
        'invalid-amount',
        'that link is for a token transfer; this form sends ETH',
      )
    }

    const fromLink = parsed.valueWei
    const valueWei = amount.trim().length > 0 ? parseEthInput(amount) : fromLink

    if (valueWei === null || valueWei <= 0n) {
      throw new WalletError('invalid-amount', 'the link carries no amount, so enter one')
    }

    return { to: parsed.address, valueWei }
  }

  return { to: assertAddress(target, 'recipient'), valueWei: parseEthInput(amount) }
}

/** Parses a payment URI back into its parts; rejects other chains outright. */
export function parseEthereumPaymentUri(uri: string): {
  address: HexString
  valueWei: bigint | null
  tokenAddress: HexString | null
} {
  const prefix = 'ethereum:'

  if (!uri.startsWith(prefix)) {
    throw new WalletError('invalid-address', 'payment URI must start with ethereum:')
  }

  const [target, queryString = ''] = uri.slice(prefix.length).split('?')
  const [addressPart, chainPart] = (target ?? '').split('@')

  if (chainPart !== undefined && Number(chainPart) !== SEPOLIA_CHAIN_ID) {
    throw new WalletError('unsupported-chain', `payment URI points at chain ${chainPart}`)
  }

  const address = assertAddress(addressPart ?? '', 'payment URI address')
  const query = new URLSearchParams(queryString)
  const value = query.get('value')
  const token = query.get('token')

  return {
    address,
    valueWei: value ? BigInt(value) : null,
    tokenAddress: token ? (token as HexString) : null,
  }
}
