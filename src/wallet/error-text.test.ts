import { describe, expect, it } from 'vitest'

import { condenseChainError, MAX_CHAIN_ERROR_LENGTH } from './error-text'

/**
 * The exact text the live demo's payer produced against the public Sepolia
 * endpoint with an empty wallet. It is copied here rather than paraphrased so
 * the classifier is measured against the shape viem really emits, and the same
 * string is in `docs/demo/facts.json` as the run's record.
 */
const OUT_OF_FUNDS_DUMP = `Transaction creation failed.

URL: https://ethereum-sepolia-rpc.publicnode.com
Request body: {"method":"eth_estimateGas","params":[{"from":"0x7EA5440E00eF463600154a132a18842701214c34","to":"0xca7D79A2Ce605b4cb705cda421E767D349FD44B2","value":"0x38d7ea4c68000"}]}
 
Estimate Gas Arguments:
  from:   0x7EA5440E00eF463600154a132a18842701214c34
  to:     0xca7D79A2Ce605b4cb705cda421E767D349FD44B2
  value:  0.001 ETH

Details: EVM error: OutOfFunds
Version: viem@2.56.9`

const REVERT_DUMP = `Transaction creation failed.

URL: https://ethereum-sepolia-rpc.publicnode.com
Details: execution reverted: ERC20: transfer amount exceeds balance
Version: viem@2.56.9`

describe('condenseChainError', () => {
  it('turns the live demo’s OutOfFunds dump into one actionable sentence', () => {
    const message = condenseChainError(new Error(OUT_OF_FUNDS_DUMP))

    expect(message).toBe(
      'This wallet does not hold enough Sepolia ETH to cover the amount plus the fee. Send testnet ETH to the address above and try again.',
    )
  })

  it('shows neither the endpoint URL nor the request body', () => {
    for (const cause of [new Error(OUT_OF_FUNDS_DUMP), new Error(REVERT_DUMP)]) {
      const message = condenseChainError(cause)

      expect(message).not.toContain('\n')
      expect(message).not.toContain('https://')
      expect(message).not.toContain('Request body')
      expect(message).not.toContain('eth_estimateGas')
    }
  })

  it('keeps the provider’s reason when it does not recognise the failure', () => {
    expect(condenseChainError(new Error(REVERT_DUMP))).toBe(
      'Transaction creation failed. (execution reverted: ERC20: transfer amount exceeds balance)',
    )
  })

  it('names an endpoint that never answered', () => {
    expect(condenseChainError(new Error('TypeError: fetch failed'))).toContain(
      'could not be reached',
    )
    expect(condenseChainError(new Error('connect ECONNREFUSED 127.0.0.1:8545'))).toContain(
      'could not be reached',
    )
  })

  it('names an endpoint that is rate-limiting the app', () => {
    expect(condenseChainError(new Error('HTTP 429 Too Many Requests'))).toContain('rate-limiting')
  })

  it('caps a long single-line provider message', () => {
    const message = condenseChainError(new Error('x'.repeat(500)))

    expect(message.length).toBeLessThanOrEqual(MAX_CHAIN_ERROR_LENGTH)
    expect(message.endsWith('…')).toBe(true)
  })

  it('handles a thrown value that is not an Error at all', () => {
    expect(condenseChainError(undefined)).toBe('the Sepolia endpoint did not answer')
    expect(condenseChainError('   ')).toBe('the Sepolia endpoint did not answer')
    expect(condenseChainError(42)).toBe('the Sepolia endpoint did not answer')
  })

  it('still accepts a plain string, which is what a rejected promise may carry', () => {
    expect(condenseChainError('insufficient funds for gas * price + value')).toContain(
      'does not hold enough Sepolia ETH',
    )
  })
})
