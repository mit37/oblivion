import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SEPOLIA_RPC_URL,
  MAINNET_CHAIN_ID,
  MainnetRefusedError,
  SEPOLIA_CHAIN_ID,
  UnsupportedChainError,
  WalletError,
  assertHttpUrl,
  assertSepoliaChainId,
  explorerAddressUrl,
  explorerTransactionUrl,
  isSepolia,
  resolveRpcUrl,
} from './chain'

describe('chain constants', () => {
  it('pins Sepolia and mainnet ids', () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11_155_111)
    expect(MAINNET_CHAIN_ID).toBe(1)
  })

  it('ships a keyless https default endpoint', () => {
    expect(DEFAULT_SEPOLIA_RPC_URL.startsWith('https://')).toBe(true)
    expect(DEFAULT_SEPOLIA_RPC_URL).not.toMatch(/key=/i)
  })
})

describe('assertSepoliaChainId', () => {
  it('accepts Sepolia', () => {
    expect(() => assertSepoliaChainId(SEPOLIA_CHAIN_ID)).not.toThrow()
    expect(isSepolia(SEPOLIA_CHAIN_ID)).toBe(true)
  })

  it('refuses mainnet with a dedicated error', () => {
    expect(() => assertSepoliaChainId(MAINNET_CHAIN_ID)).toThrow(MainnetRefusedError)

    try {
      assertSepoliaChainId(MAINNET_CHAIN_ID)
    } catch (error) {
      expect((error as WalletError).code).toBe('mainnet-refused')
      expect((error as Error).message).toMatch(/mainnet/i)
    }
  })

  it('refuses any other chain and names it', () => {
    expect(() => assertSepoliaChainId(8453)).toThrow(UnsupportedChainError)

    try {
      assertSepoliaChainId(8453)
    } catch (error) {
      expect((error as WalletError).code).toBe('unsupported-chain')
      expect((error as Error).message).toContain('8453')
    }
  })

  it('refuses chain id 0 and negative ids', () => {
    expect(() => assertSepoliaChainId(0)).toThrow(UnsupportedChainError)
    expect(() => assertSepoliaChainId(-1)).toThrow(UnsupportedChainError)
  })

  it('does not treat a chain id of "1" as a string as mainnet', () => {
    expect(() => assertSepoliaChainId(Number('1'))).toThrow(MainnetRefusedError)
  })
})

describe('resolveRpcUrl', () => {
  it('falls back to the public default', () => {
    expect(resolveRpcUrl()).toBe(DEFAULT_SEPOLIA_RPC_URL)
  })

  it('prefers an explicit endpoint', () => {
    expect(resolveRpcUrl('https://sepolia.example.org')).toBe('https://sepolia.example.org')
  })

  it('rejects a non-http scheme', () => {
    expect(() => resolveRpcUrl('ws://sepolia.example.org')).toThrow(WalletError)
  })

  it('rejects a relative value', () => {
    expect(() => resolveRpcUrl('sepolia.example.org')).toThrow(WalletError)
  })

  it('accepts plain http for a local node', () => {
    expect(assertHttpUrl('http://127.0.0.1:8545')).toBe('http://127.0.0.1:8545')
  })
})

describe('explorer links', () => {
  it('links a transaction', () => {
    expect(explorerTransactionUrl('0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc')
  })

  it('links an address', () => {
    expect(explorerAddressUrl('0xabc')).toBe('https://sepolia.etherscan.io/address/0xabc')
  })
})
