import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { AutoLockController, observeActivity } from '../vault/auto-lock'
import {
  clearIdentityCache,
  deriveIdentitySummary,
  type VaultIdentitySummary,
} from '../vault/identity'
import { DEFAULT_AUTO_LOCK_MINUTES, type VaultDocument } from '../vault/schema'
import { IndexedDbVaultStorage } from '../vault/storage-idb'
import { Vault, type CreatedVault } from '../vault/vault'

export type VaultStatus = 'loading' | 'empty' | 'locked' | 'unlocked'

export interface VaultContextValue {
  readonly status: VaultStatus
  readonly document: VaultDocument | null
  readonly identity: VaultIdentitySummary | null
  readonly autoLockMinutes: number
  create: (password: string) => Promise<CreatedVault>
  unlock: (password: string) => Promise<void>
  verifyPassword: (password: string) => Promise<boolean>
  lock: () => void
  update: (mutator: (document: VaultDocument) => VaultDocument) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  setAutoLockMinutes: (minutes: number) => Promise<void>
  destroy: () => Promise<void>
}

const VaultContext = createContext<VaultContextValue | null>(null)

export interface VaultProviderProps {
  readonly children: ReactNode
  /**
   * Tests inject a vault backed by in-memory storage and the deliberately weak
   * test KDF profile. The app itself always uses IndexedDB and the interactive
   * profile.
   */
  readonly vaultFactory?: () => Vault
  /** Where activity events are watched. Defaults to the browser window. */
  readonly autoLockTarget?: EventTarget
}

export function VaultProvider({ children, vaultFactory, autoLockTarget }: VaultProviderProps) {
  const vault = useMemo(
    () => vaultFactory?.() ?? new Vault({ storage: new IndexedDbVaultStorage() }),
    [vaultFactory],
  )

  const [status, setStatus] = useState<VaultStatus>('loading')
  const [document, setDocument] = useState<VaultDocument | null>(null)
  const [identity, setIdentity] = useState<VaultIdentitySummary | null>(null)
  const [autoLockMinutes, setMinutes] = useState(DEFAULT_AUTO_LOCK_MINUTES)
  const controller = useRef<AutoLockController | null>(null)

  const lock = useCallback(() => {
    vault.lock()
    clearIdentityCache()
    controller.current?.stop()
    setDocument(null)
    setIdentity(null)
    setStatus((previous) => (previous === 'empty' ? 'empty' : 'locked'))
  }, [vault])

  const activate = useCallback(async (nextDocument: VaultDocument) => {
    const summary = await deriveIdentitySummary(
      nextDocument.identity.mnemonic,
      nextDocument.settings.addressIndex,
    )

    controller.current?.setMinutes(nextDocument.settings.autoLockMinutes)
    controller.current?.start()

    setDocument(nextDocument)
    setIdentity(summary)
    setMinutes(nextDocument.settings.autoLockMinutes)
    setStatus('unlocked')
  }, [])

  // One controller for the life of the provider; Settings only changes its clock.
  useEffect(() => {
    const next = new AutoLockController(() => {
      lock()
    }, autoLockMinutes)
    controller.current = next

    return () => {
      next.stop()
      controller.current = null
    }
  }, [autoLockMinutes, lock])

  // Count pointer, key and wheel activity as "still here".
  useEffect(() => {
    const target = autoLockTarget ?? (typeof window === 'undefined' ? null : window)
    const active = controller.current
    if (!target || !active) return

    return observeActivity(active, target)
  }, [autoLockTarget])

  // Is there a vault on this device? Never auto-unlocks: a reload starts locked.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const exists = await vault.exists()
        if (!cancelled) setStatus(exists ? 'locked' : 'empty')
      } catch {
        if (!cancelled) setStatus('empty')
      }
    })()

    return () => {
      cancelled = true
      vault.lock()
    }
  }, [vault])

  const create = useCallback(
    async (password: string) => {
      const created = await vault.create(password)
      await activate(created.document)
      return created
    },
    [activate, vault],
  )

  const unlock = useCallback(
    async (password: string) => {
      await activate(await vault.unlock(password))
    },
    [activate, vault],
  )

  const verifyPassword = useCallback(
    async (password: string) => {
      try {
        await vault.unlock(password)
        return true
      } catch {
        return false
      }
    },
    [vault],
  )

  const update = useCallback(
    async (mutator: (current: VaultDocument) => VaultDocument) => {
      setDocument(await vault.update(mutator))
    },
    [vault],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await vault.changePassword(currentPassword, newPassword)
    },
    [vault],
  )

  const setAutoLockMinutes = useCallback(
    async (minutes: number) => {
      const next = await vault.update((current) => ({
        ...current,
        settings: { ...current.settings, autoLockMinutes: minutes },
      }))

      controller.current?.setMinutes(next.settings.autoLockMinutes)
      setMinutes(next.settings.autoLockMinutes)
    },
    [vault],
  )

  const destroy = useCallback(async () => {
    await vault.destroy()
    clearIdentityCache()
    controller.current?.stop()
    setDocument(null)
    setIdentity(null)
    setStatus('empty')
  }, [vault])

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      document,
      identity,
      autoLockMinutes,
      create,
      unlock,
      verifyPassword,
      lock,
      update,
      changePassword,
      setAutoLockMinutes,
      destroy,
    }),
    [
      status,
      document,
      identity,
      autoLockMinutes,
      create,
      unlock,
      verifyPassword,
      lock,
      update,
      changePassword,
      setAutoLockMinutes,
      destroy,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

// The hook lives beside the provider on purpose: they share the private context.
// eslint-disable-next-line react-refresh/only-export-components
export function useVault(): VaultContextValue {
  const value = useContext(VaultContext)

  if (!value) {
    throw new Error('useVault must be used inside a VaultProvider')
  }

  return value
}
