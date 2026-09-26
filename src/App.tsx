import { useState } from 'react'

import { SAFETY_CHAIN_NOTE, SAFETY_LABEL, SAFETY_WARNING } from './safety'
import { Dashboard } from './ui/Dashboard'
import { VaultGate } from './ui/VaultGate'
import { VaultProvider, useVault } from './ui/vault-context'
import type { Vault } from './vault/vault'

export interface AppProps {
  /** Tests inject a vault with in-memory storage and the test KDF profile. */
  readonly vaultFactory?: () => Vault
  readonly autoLockTarget?: EventTarget
}

export default function App({ vaultFactory, autoLockTarget }: AppProps = {}) {
  return (
    <VaultProvider vaultFactory={vaultFactory} autoLockTarget={autoLockTarget}>
      <Shell />
    </VaultProvider>
  )
}

function Shell() {
  const { status } = useVault()
  const [gateActive, setGateActive] = useState(false)

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ◐
          </span>
          <div>
            <h1>Oblivion</h1>
            <p className="tagline">One encrypted vault for your messages and your testnet money.</p>
          </div>
        </div>
        <span className="pill">{SAFETY_LABEL}</span>
      </header>

      <aside className="safety-banner" data-testid="safety-banner" aria-label="Safety notice">
        <strong>{SAFETY_LABEL}</strong>
        <p>{SAFETY_WARNING}</p>
        <p className="safety-detail">{SAFETY_CHAIN_NOTE}</p>
      </aside>

      <main className="shell-main">
        {status === 'loading' ? (
          <p className="muted">Opening Oblivion…</p>
        ) : status === 'unlocked' && !gateActive ? (
          <Dashboard />
        ) : (
          <VaultGate onFlowChange={setGateActive} />
        )}
      </main>

      <footer className="footer">
        No telemetry, no analytics, no servers of its own. Source and plan:{' '}
        <a href="https://github.com/mit37/oblivion">github.com/mit37/oblivion</a>.
      </footer>
    </>
  )
}
