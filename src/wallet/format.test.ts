import { describe, expect, it } from 'vitest'

import { SEPOLIA_CHAIN_ID, WalletError } from './chain'
import {
  assertAddress,
  ethereumPaymentUri,
  formatEth,
  formatTokenAmount,
  parseEthInput,
  parseEthereumPaymentUri,
  parseTokenAmount,
  resolveTransferRequest,
  shortenAddress,
} from './format'

const ADDRESS = '0x1234567890AbCdEf1234567890aBcDeF12345678'
const TOKEN = '0x0dE8B2F1a0e2c1d3E4f5A6b7C8d9E0f1A2b3C4d5'

describe('shortenAddress', () => {
  it('shortens a long address', () => {
    expect(shortenAddress(ADDRESS)).toBe('0x1234…5678')
  })

  it('leaves a short value alone', () => {
    expect(shortenAddress('0x12')).toBe('0x12')
  })
})

describe('assertAddress', () => {
  it('accepts a valid address and trims it', () => {
    expect(assertAddress(` ${ADDRESS} `)).toBe(ADDRESS)
  })

  it('accepts a mixed-case address without checksum validation', () => {
    expect(assertAddress('0xAbC1111111111111111111111111111111111111')).toBe(
      '0xAbC1111111111111111111111111111111111111',
    )
  })

  it('rejects junk and short values', () => {
    expect(() => assertAddress('0x12')).toThrow(WalletError)
    expect(() => assertAddress('not an address')).toThrow(WalletError)
  })

  it('reports which field was wrong', () => {
    try {
      assertAddress('nope', 'recipient')
    } catch (error) {
      expect((error as Error).message).toContain('recipient')
    }
  })
})

describe('ETH amounts', () => {
  it('formats wei as ETH', () => {
    expect(formatEth(420_000_000_000_000n)).toBe('0.00042')
    expect(formatEth(1_000_000_000_000_000_000n)).toBe('1')
    expect(formatEth(0n)).toBe('0')
  })

  it('trims to a maximum number of decimals', () => {
    expect(formatEth(1_234_567_890_123_456_789n, { maxDecimals: 4 })).toBe('1.2345')
    expect(formatEth(1_000_100_000_000_000_000n, { maxDecimals: 4 })).toBe('1.0001')
    expect(formatEth(1_000_000_000_000_000_001n, { maxDecimals: 2 })).toBe('1')
  })

  it('parses a decimal ETH amount', () => {
    expect(parseEthInput('0.0015')).toBe(1_500_000_000_000_000n)
    expect(parseEthInput(' 1 ')).toBe(1_000_000_000_000_000_000n)
  })

  it('rounds sub-wei precision to the nearest wei, as viem does', () => {
    expect(parseEthInput('0.1234567890123456789')).toBe(123_456_789_012_345_679n)
  })

  it('rejects an amount that rounds to zero', () => {
    expect(() => parseEthInput('0.0000000000000000001')).toThrow(WalletError)
  })

  it('rejects an empty amount', () => {
    expect(() => parseEthInput('   ')).toThrow(WalletError)
  })

  it('rejects scientific notation and signs', () => {
    expect(() => parseEthInput('1e5')).toThrow(WalletError)
    expect(() => parseEthInput('-1')).toThrow(WalletError)
    expect(() => parseEthInput('+1')).toThrow(WalletError)
  })

  it('rejects a zero amount', () => {
    expect(() => parseEthInput('0')).toThrow(WalletError)
  })

  it('rejects a trailing dot with no digits', () => {
    expect(() => parseEthInput('1.')).toThrow(WalletError)
  })
})

describe('token amounts', () => {
  const usdc = { symbol: 'USDC', decimals: 6 }

  it('formats with the token decimals and symbol', () => {
    expect(formatTokenAmount(1_500_000n, usdc)).toBe('1.5 USDC')
    expect(formatTokenAmount(0n, usdc)).toBe('0 USDC')
  })

  it('parses with the token decimals', () => {
    expect(parseTokenAmount('1.5', 6)).toBe(1_500_000n)
  })

  it('rejects amounts that round to zero for the token', () => {
    expect(() => parseTokenAmount('0.0000001', 6)).toThrow(WalletError)
  })
})

describe('EIP-681 payment URIs', () => {
  it('encodes the chain and address', () => {
    expect(ethereumPaymentUri('0xABCDEF1234567890abcdef1234567890ABCDEF12')).toBe(
      `ethereum:0xabcdef1234567890abcdef1234567890abcdef12@${SEPOLIA_CHAIN_ID}`,
    )
  })

  it('includes an amount when one is given', () => {
    expect(ethereumPaymentUri(ADDRESS, { valueWei: 1_000_000_000_000_000n })).toBe(
      `ethereum:${ADDRESS.toLowerCase()}@${SEPOLIA_CHAIN_ID}?value=1000000000000000`,
    )
  })

  it('omits a zero-wei amount', () => {
    expect(ethereumPaymentUri(ADDRESS, { valueWei: 0n })).not.toContain('value=')
  })

  it('includes a token address when one is given', () => {
    expect(ethereumPaymentUri(ADDRESS, { tokenAddress: TOKEN })).toContain(
      `token=${TOKEN.toLowerCase()}`,
    )
  })

  it('round-trips through the parser', () => {
    const uri = ethereumPaymentUri(ADDRESS, { valueWei: 42n })
    const parsed = parseEthereumPaymentUri(uri)

    expect(parsed.address.toLowerCase()).toBe(ADDRESS.toLowerCase())
    expect(parsed.valueWei).toBe(42n)
    expect(parsed.tokenAddress).toBeNull()
  })

  it('rejects a URI for another chain', () => {
    expect(() => parseEthereumPaymentUri(`ethereum:${ADDRESS}@1?value=1`)).toThrow(WalletError)
  })

  it('rejects a URI with another scheme', () => {
    expect(() => parseEthereumPaymentUri(`bitcoin:${ADDRESS}`)).toThrow(WalletError)
  })

  it('rejects a URI with a junk address', () => {
    expect(() => parseEthereumPaymentUri('ethereum:nope')).toThrow(WalletError)
  })
})

describe('resolveTransferRequest', () => {
  it('reads a plain address and amount', () => {
    const transfer = resolveTransferRequest(ADDRESS, '0.25')
    expect(transfer.to).toBe(ADDRESS)
    expect(transfer.valueWei).toBe(250_000_000_000_000_000n)
  })

  it('trims the address someone pasted with spaces', () => {
    expect(resolveTransferRequest(`  ${ADDRESS}  `, '1').to).toBe(ADDRESS)
  })

  it('takes the amount from a payment link when the field is empty', () => {
    const transfer = resolveTransferRequest(ethereumPaymentUri(ADDRESS, { valueWei: 7n }), '')
    expect(transfer.to.toLowerCase()).toBe(ADDRESS.toLowerCase())
    expect(transfer.valueWei).toBe(7n)
  })

  it('lets a typed amount override the one in the link', () => {
    const transfer = resolveTransferRequest(ethereumPaymentUri(ADDRESS, { valueWei: 7n }), '0.5')
    expect(transfer.valueWei).toBe(500_000_000_000_000_000n)
  })

  it('refuses a link with no amount when none is typed', () => {
    expect(() => resolveTransferRequest(ethereumPaymentUri(ADDRESS), '')).toThrow(
      /link carries no amount/,
    )
  })

  it('refuses an empty recipient', () => {
    expect(() => resolveTransferRequest('   ', '0.1')).toThrow(/enter a recipient/)
  })

  it('refuses a name instead of an address', () => {
    expect(() => resolveTransferRequest('vitalik.eth', '0.1')).toThrow(WalletError)
  })

  it('refuses a link that points at mainnet', () => {
    expect(() => resolveTransferRequest(`ethereum:${ADDRESS}@1?value=1`, '')).toThrow(/chain 1/)
  })

  it('refuses a token link from the ETH form', () => {
    expect(() =>
      resolveTransferRequest(ethereumPaymentUri(ADDRESS, { tokenAddress: TOKEN }), '1'),
    ).toThrow(/token transfer/)
  })

  it('refuses a zero amount', () => {
    expect(() => resolveTransferRequest(ADDRESS, '0')).toThrow(/at least 1 wei/)
  })
})
