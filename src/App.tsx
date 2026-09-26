import { SAFETY_CHAIN_NOTE, SAFETY_LABEL, SAFETY_WARNING } from './safety'

type MilestoneStatus = 'done' | 'planned'

interface Milestone {
  readonly id: number
  readonly title: string
  readonly status: MilestoneStatus
}

/**
 * The PRD §5 milestones, shown in the shell so the demo always says honestly
 * what exists today and what does not yet.
 */
const MILESTONES: readonly Milestone[] = [
  { id: 1, title: 'Scaffold, CI, static deploy', status: 'done' },
  { id: 2, title: 'Crypto module (Argon2id, XChaCha20-Poly1305, BIP-39/44)', status: 'planned' },
  { id: 3, title: 'Encrypted vault (create / unlock / lock / re-wrap)', status: 'planned' },
  { id: 4, title: 'Ethereum Sepolia wallet (balance, receive, send, history)', status: 'planned' },
  { id: 5, title: 'Waku 1:1 end-to-end encrypted messaging', status: 'planned' },
  { id: 6, title: 'Pay-in-chat payment requests', status: 'planned' },
  { id: 7, title: 'Security write-up (docs/SECURITY.md threat model)', status: 'planned' },
  { id: 8, title: 'README, demo recording, tag v2.0.0', status: 'planned' },
]

export default function App() {
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

      <main className="card">
        <h2>Build status</h2>
        <p>
          Milestone 1 of 8 — scaffold, CI and static deploy. Nothing in this shell holds keys, funds
          or messages yet.
        </p>
        <ol className="milestones">
          {MILESTONES.map((milestone) => (
            <li key={milestone.id} className={`milestone milestone--${milestone.status}`}>
              <span className="milestone-id">{String(milestone.id).padStart(2, '0')}</span>
              <span className="milestone-title">{milestone.title}</span>
              <span className="milestone-status">
                {milestone.status === 'done' ? 'done' : 'planned'}
              </span>
            </li>
          ))}
        </ol>
      </main>

      <footer className="footer">
        No telemetry, no analytics, no servers of its own. Source and plan:{' '}
        <a href="https://github.com/mit37/oblivion">github.com/mit37/oblivion</a>.
      </footer>
    </>
  )
}
