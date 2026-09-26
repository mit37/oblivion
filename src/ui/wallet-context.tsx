import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { deriveWalletAccount, type HexString } from '../crypto/keys'
import { WalletError } from '../wallet/chain'
import {
  createSepoliaPublicClient,
  createSepoliaWalletClient,
  toChainReader,
  toChainSender,
} from '../wallet/clients'
import { WalletService, type SendRequest } from '../wallet/service'
import type { TokenBalance, TokenInfo, TransactionStatus, WalletTransaction } from '../wallet/types'
import { useVault } from './vault-context'

/** What the wallet needs from the unlocked vault to build a signer. */
export interface WalletIdentity {
  readonly address: HexString
  readonly mnemonic: string
  readonly addressIndex: number
}

export type WalletFactory = (identity: WalletIdentity) => WalletService

/**
 * Production factory: derives the signing key for the vault's address index.
 * The key exists while the vault is unlocked, and the service — with it — is
 * dropped the moment the vault locks, so a locked app holds no signing key.
 */
export function defaultWalletFactory(identity: WalletIdentity): WalletService {
  const account = deriveWalletAccount(identity.mnemonic, identity.addressIndex)

  return new WalletService({
    reader: toChainReader(createSepoliaPublicClient()),
    sender: toChainSender(createSepoliaWalletClient(account.privateKey)),
  })
}

export type WalletLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface WalletErrorInfo {
  readonly message: string
  readonly code: WalletError['code'] | 'unknown'
}

export interface SentTransaction {
  readonly hash: HexString
  readonly feeWei: bigint
  readonly status: TransactionStatus | null
}

export interface WalletContextValue {
  readonly address: HexString
  readonly rpcUrl: string
  readonly canSend: boolean
  readonly state: WalletLoadState
  readonly error: WalletErrorInfo | null
  readonly balanceWei: bigint | null
  readonly tokens: readonly TokenInfo[]
  readonly tokenBalances: readonly TokenBalance[]
  readonly history: readonly WalletTransaction[]
  readonly lastSent: SentTransaction | null
  refresh: () => Promise<void>
  estimateSend: (request: SendRequest) => ReturnType<WalletService['estimateSend']>
  send: (request: SendRequest) => Promise<{ hash: HexString; feeWei: bigint }>
  checkTransaction: (hash: string) => Promise<TransactionStatus>
  addToken: (address: string) => Promise<TokenInfo>
  removeToken: (address: HexString) => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export interface WalletProviderProps {
  readonly children: ReactNode
  /** Test seam: tests pass a service backed by `FakeChain`, so nothing hits the network. */
  readonly factory?: WalletFactory
}

/**
 * Everything read from the chain, stamped with the service that read it.
 *
 * The stamp is what makes a slow reply harmless: results that belong to a vault
 * that has since locked (or to another account) are ignored at render time
 * rather than guarded by a mutable counter.
 */
interface WalletData {
  readonly service: WalletService
  readonly balanceWei: bigint
  readonly tokenBalances: readonly TokenBalance[]
  readonly history: readonly WalletTransaction[]
}

interface WalletStatus {
  readonly service: WalletService
  readonly state: 'loading' | 'ready' | 'error'
  readonly error: WalletErrorInfo | null
}

/** What was sent, kept with the account it came from so a switch cannot inherit it. */
interface SentRecord extends SentTransaction {
  readonly address: HexString
}

export function WalletProvider({ children, factory }: WalletProviderProps) {
  const { status, document, identity, update } = useVault()

  const walletIdentity = useMemo<WalletIdentity | null>(() => {
    if (status !== 'unlocked' || !document || !identity) return null

    return {
      address: identity.address,
      mnemonic: document.identity.mnemonic,
      addressIndex: document.settings.addressIndex,
    }
  }, [document, identity, status])

  /**
   * Derived, not stored: when the vault locks, `walletIdentity` becomes null and
   * the service (with the signing key inside it) goes with it. Construction can
   * only fail on a build-time misconfiguration, and failing loudly beats a
   * quietly missing wallet.
   */
  const service = useMemo(
    () => (walletIdentity ? (factory ?? defaultWalletFactory)(walletIdentity) : null),
    [factory, walletIdentity],
  )

  const tokens = useMemo(() => document?.tokens ?? [], [document])

  const [data, setData] = useState<WalletData | null>(null)
  const [loadStatus, setLoadStatus] = useState<WalletStatus | null>(null)
  const [sent, setSent] = useState<SentRecord | null>(null)

  /**
   * The one read path. The chain guard runs first, so an endpoint that is not
   * Sepolia is refused before any balance or history call is attempted, and the
   * caller has not been told "loading" for a chain we will not use.
   */
  const load = useCallback(
    async (watched: readonly TokenInfo[]) => {
      if (!service || !walletIdentity) return

      const address = walletIdentity.address

      try {
        await service.assertChain()

        setLoadStatus({ service, state: 'loading', error: null })

        const [balanceWei, tokenBalances, history] = await Promise.all([
          service.getBalance(address),
          service.getTokenBalances(address, watched),
          service.getHistory({ address }),
        ])

        setData({ service, balanceWei, tokenBalances, history })
        setLoadStatus({ service, state: 'ready', error: null })
      } catch (cause) {
        setLoadStatus({ service, state: 'error', error: describeWalletError(cause) })
      }
    },
    [service, walletIdentity],
  )

  // Read the wallet once per unlocked identity, and again when the watched token
  // list changes: adding a token is what makes its balance appear.
  useEffect(() => {
    // Kicked off in a microtask rather than called inline: the read updates
    // state only after it has an answer, so the effect itself never cascades.
    void (async () => {
      await load(tokens)
    })()
  }, [load, tokens])

  const refresh = useCallback(async () => {
    await load(tokens)
  }, [load, tokens])

  const send = useCallback(
    async (request: SendRequest) => {
      if (!service) {
        throw new WalletError('chain-unavailable', 'the vault is locked')
      }

      const result = await service.send(request)

      setSent({
        address: request.from,
        hash: result.hash,
        feeWei: result.fee.estimatedFeeWei,
        status: { state: 'pending', blockNumber: null, gasUsedWei: null },
      })

      return { hash: result.hash, feeWei: result.fee.estimatedFeeWei }
    },
    [service],
  )

  const checkTransaction = useCallback(
    async (hash: string) => {
      if (!service) {
        throw new WalletError('chain-unavailable', 'the vault is locked')
      }

      const next = await service.getTransactionStatus(hash)

      setSent((current) =>
        current && current.hash === hash ? { ...current, status: next } : current,
      )

      if (next.state === 'confirmed') await load(tokens)

      return next
    },
    [load, service, tokens],
  )

  const addToken = useCallback(
    async (address: string) => {
      if (!service) {
        throw new WalletError('chain-unavailable', 'the vault is locked')
      }

      const token = await service.loadToken(address)

      await update((current) => ({
        ...current,
        tokens: [
          ...current.tokens.filter(
            (existing) => existing.address.toLowerCase() !== token.address.toLowerCase(),
          ),
          token,
        ],
      }))

      return token
    },
    [service, update],
  )

  const removeToken = useCallback(
    async (address: HexString) => {
      await update((current) => ({
        ...current,
        tokens: current.tokens.filter(
          (existing) => existing.address.toLowerCase() !== address.toLowerCase(),
        ),
      }))
    },
    [update],
  )

  const value = useMemo<WalletContextValue | null>(() => {
    if (!service || !walletIdentity) return null

    // Only state that belongs to the current service is shown.
    const owned = data && data.service === service ? data : null
    const current = loadStatus && loadStatus.service === service ? loadStatus : null

    // A transaction sent from a different account is not this session's to show.
    const lastSent =
      sent && sent.address.toLowerCase() === walletIdentity.address.toLowerCase() ? sent : null

    return {
      address: walletIdentity.address,
      rpcUrl: service.rpcUrl,
      canSend: service.canSend,
      state: current?.state ?? 'loading',
      error: current?.error ?? null,
      balanceWei: owned?.balanceWei ?? null,
      tokens,
      tokenBalances: owned?.tokenBalances ?? [],
      history: owned?.history ?? [],
      lastSent,
      refresh,
      estimateSend: (request) => service.estimateSend(request),
      send,
      checkTransaction,
      addToken,
      removeToken,
    }
  }, [
    addToken,
    checkTransaction,
    data,
    loadStatus,
    refresh,
    removeToken,
    send,
    sent,
    service,
    tokens,
    walletIdentity,
  ])

  if (!value) return null

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

/** Turns any thrown value into something the UI can show without leaking keys. */
export function describeWalletError(cause: unknown): WalletErrorInfo {
  if (cause instanceof WalletError) {
    return { message: cause.message, code: cause.code }
  }

  if (cause instanceof Error) {
    return { message: cause.message, code: 'unknown' }
  }

  return { message: 'the wallet could not reach Sepolia', code: 'unknown' }
}

// The hook lives beside the provider on purpose: they share the private context.
// eslint-disable-next-line react-refresh/only-export-components
export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext)

  if (!value) {
    throw new Error('useWallet must be used inside a WalletProvider with an unlocked vault')
  }

  return value
}
