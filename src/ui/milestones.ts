/**
 * The PRD §5 milestones, shown in the app so the demo always states honestly
 * what exists and what does not. Bump `MILESTONES_DONE` as milestones land.
 */
export interface MilestoneInfo {
  readonly id: number
  readonly title: string
}

export const MILESTONES: readonly MilestoneInfo[] = [
  { id: 1, title: 'Scaffold, CI, static deploy' },
  { id: 2, title: 'Crypto module (Argon2id, XChaCha20-Poly1305, BIP-39/44)' },
  { id: 3, title: 'Encrypted vault (create / unlock / lock / re-wrap)' },
  { id: 4, title: 'Ethereum Sepolia wallet (balance, receive, send, history)' },
  { id: 5, title: 'Waku 1:1 end-to-end encrypted messaging' },
  { id: 6, title: 'Pay-in-chat payment requests' },
  { id: 7, title: 'Security write-up (docs/SECURITY.md threat model)' },
  { id: 8, title: 'README, demo recording, tag v2.0.0' },
]

export const MILESTONES_DONE = 4

export type MilestoneStatus = 'done' | 'planned'

export function milestoneStatus(id: number): MilestoneStatus {
  return id <= MILESTONES_DONE ? 'done' : 'planned'
}
