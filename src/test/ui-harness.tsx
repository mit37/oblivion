/**
 * Test harness for anything that needs an unlocked vault.
 *
 * It creates a vault with in-memory storage and the deliberately weak test KDF
 * profile (so tests stay fast), then mounts children inside the wallet provider
 * with a caller-supplied factory. No test using this ever reaches the network:
 * the wallet service is always built over `FakeChain`.
 */
import { useEffect, type ReactNode } from 'react'

import type { MessageTransport } from '../messaging/transport'
import { FakeChain, createFakeSender } from '../wallet/fake-chain'
import { WalletService } from '../wallet/service'
import type { ChainReader, ChainSender } from '../wallet/types'
import { MessagingProvider } from '../ui/messaging-context'
import { VaultProvider, useVault } from '../ui/vault-context'
import { WalletProvider, type WalletFactory } from '../ui/wallet-context'
import { MemoryVaultStorage } from '../vault/storage'
import { Vault } from '../vault/vault'

export const TEST_PASSWORD = 'correct horse battery staple'

/** A vault backed by in-memory storage and the fast test KDF profile. */
export function testVault(storage: MemoryVaultStorage): Vault {
  return new Vault({ storage, kdfProfile: 'test', allowTestProfile: true })
}

/** A wallet service over a fake reader and (optionally) a fake sender. */
export function fakeWalletService(reader: ChainReader, sender?: ChainSender): WalletService {
  return new WalletService({
    reader,
    sender,
    rpcUrl: 'https://sepolia.example/rpc',
  })
}

/**
 * A wallet factory for tests that only need the wallet not to touch the
 * network: one Sepolia chain double, shared by every service built from it.
 */
export function offlineWalletFactory(
  chain: FakeChain = new FakeChain({ balanceWei: 10n ** 18n }),
): WalletFactory {
  return () => fakeWalletService(chain, createFakeSender())
}

export interface WalletHarnessProps {
  readonly children: ReactNode
  readonly factory: WalletFactory
  /** Reuse storage between renders to test what survives a reload. */
  readonly storage?: MemoryVaultStorage
}

/** Creates the vault on first mount, then renders children once it is unlocked. */
export function UnlockedVaultHarness({
  children,
  factory,
  storage = new MemoryVaultStorage(),
}: WalletHarnessProps) {
  return (
    <VaultProvider vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()}>
      <UnlockThenRender factory={factory}>{children}</UnlockThenRender>
    </VaultProvider>
  )
}

function UnlockThenRender({
  children,
  factory,
}: {
  readonly children: ReactNode
  readonly factory: WalletFactory
}) {
  const unlocked = useUnlockedVault()

  if (!unlocked) return null

  return <WalletProvider factory={factory}>{children}</WalletProvider>
}

/**
 * The same unlocked-vault start, but inside the messaging provider: tests pass a
 * transport (usually one from a shared `InMemoryNetwork`), never the network.
 */
export function UnlockedMessagingHarness({
  children,
  transportFactory,
  storage = new MemoryVaultStorage(),
}: {
  readonly children: ReactNode
  readonly transportFactory: (mode: 'local' | 'waku') => MessageTransport
  readonly storage?: MemoryVaultStorage
}) {
  return (
    <VaultProvider vaultFactory={() => testVault(storage)} autoLockTarget={new EventTarget()}>
      <UnlockThenRenderMessaging transportFactory={transportFactory}>
        {children}
      </UnlockThenRenderMessaging>
    </VaultProvider>
  )
}

function UnlockThenRenderMessaging({
  children,
  transportFactory,
}: {
  readonly children: ReactNode
  readonly transportFactory: (mode: 'local' | 'waku') => MessageTransport
}) {
  const unlocked = useUnlockedVault()

  if (!unlocked) return null

  return <MessagingProvider transportFactory={transportFactory}>{children}</MessagingProvider>
}

/** Creates the vault on first mount and reports when it is unlocked. */
function useUnlockedVault(): boolean {
  const { status, create, unlock } = useVault()

  useEffect(() => {
    if (status === 'empty') void create(TEST_PASSWORD)
    else if (status === 'locked') void unlock(TEST_PASSWORD)
  }, [status, create, unlock])

  return status === 'unlocked'
}
