import { useState, type FormEvent } from 'react'

import { SAFETY_CHAIN_NOTE, SAFETY_LABEL } from '../safety'
import { AUTO_LOCK_CHOICES_MINUTES } from '../vault/schema'
import { describeVaultError } from './gate-copy'
import { MILESTONES, milestoneStatus } from './milestones'
import { useVault } from './vault-context'

const DELETE_CONFIRMATION = 'DELETE'

export function Dashboard() {
  const {
    identity,
    document: vault,
    autoLockMinutes,
    lock,
    setAutoLockMinutes,
    changePassword,
    verifyPassword,
    destroy,
  } = useVault()

  const [revealPassword, setRevealPassword] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  if (!identity || !vault) return null

  async function handleReveal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setRevealError(null)

    if (!(await verifyPassword(revealPassword))) {
      setRevealError('That password did not open the vault.')
      return
    }

    setRevealed(vault?.identity.mnemonic ?? null)
    setRevealPassword('')
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setPasswordMessage(null)

    if (newPassword !== repeatPassword) {
      setPasswordMessage('The two new passwords do not match.')
      return
    }

    try {
      await changePassword(currentPassword, newPassword)
      setPasswordMessage('Password changed. The old password no longer opens this vault.')
      setCurrentPassword('')
      setNewPassword('')
      setRepeatPassword('')
    } catch (cause) {
      setPasswordMessage(describeVaultError(cause))
    }
  }

  async function handleDestroy(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setDeleteError(null)

    if (deleteConfirmation !== DELETE_CONFIRMATION) {
      setDeleteError(`Type ${DELETE_CONFIRMATION} to confirm.`)
      return
    }

    await destroy()
  }

  return (
    <>
      <section className="card" aria-labelledby="identity-title">
        <h2 id="identity-title">Your identity</h2>
        <p className="muted small">
          One mnemonic, two independent identities: the wallet key and the messaging key sit on
          different derivation paths, so a chat contact cannot link your messages to your wallet.
        </p>

        <dl className="facts">
          <dt>Wallet address</dt>
          <dd className="mono">{identity.address}</dd>
          <dt>Derivation path</dt>
          <dd className="mono">{identity.walletPath}</dd>
          <dt>Messaging identity</dt>
          <dd className="mono">{identity.identityString}</dd>
          <dt>Messaging derivation path</dt>
          <dd className="mono">{identity.messagingPath}</dd>
          <dt>Messaging fingerprint</dt>
          <dd className="mono">{identity.fingerprint}</dd>
          <dt>Network</dt>
          <dd>{SAFETY_CHAIN_NOTE}</dd>
        </dl>
      </section>

      <section className="card" aria-labelledby="security-title">
        <h2 id="security-title">Security</h2>

        <label className="field">
          <span>Auto-lock after inactivity</span>
          <select
            value={autoLockMinutes}
            onChange={(event) => {
              void setAutoLockMinutes(Number(event.target.value))
            }}
          >
            {AUTO_LOCK_CHOICES_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minute{minutes === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>

        <p className="muted small">
          {SAFETY_LABEL}. Locking drops the key from memory; a reload always starts locked.
        </p>

        <button type="button" className="button" onClick={lock}>
          Lock now
        </button>

        <form className="stack" onSubmit={handleChangePassword}>
          <h3>Change password</h3>
          <p className="muted small">
            Re-wraps the same vault under a new Argon2id key. Your mnemonic, contacts and history
            are untouched.
          </p>

          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Repeat new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={repeatPassword}
              onChange={(event) => setRepeatPassword(event.target.value)}
              required
            />
          </label>

          {passwordMessage ? (
            <p className="form-note" role="status">
              {passwordMessage}
            </p>
          ) : null}

          <button type="submit" className="button">
            Change password
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Recovery phrase</h2>
        <p className="muted small">
          The phrase is stored inside the encrypted vault. Revealing it decrypts nothing new, but
          anyone who reads it owns this wallet and these chats, so prove it is you first.
        </p>

        <form className="stack" onSubmit={handleReveal}>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={revealPassword}
              onChange={(event) => setRevealPassword(event.target.value)}
              required
            />
          </label>

          {revealError ? (
            <p className="form-error" role="alert">
              {revealError}
            </p>
          ) : null}

          <button type="submit" className="button">
            Reveal recovery phrase
          </button>
        </form>

        {revealed ? (
          <div className="reveal">
            <ol className="word-grid" data-testid="recovery-phrase">
              {revealed.split(' ').map((word, index) => (
                <li key={`${word}-${index}`}>
                  <span className="word-index">{index + 1}</span>
                  <span className="word-text">{word}</span>
                </li>
              ))}
            </ol>
            <button type="button" className="button" onClick={() => setRevealed(null)}>
              Hide phrase
            </button>
          </div>
        ) : null}
      </section>

      <section className="card card--danger" aria-labelledby="danger-title">
        <h2 id="danger-title">Delete this vault</h2>
        <p className="muted small">
          Removes the encrypted record from this browser. Without the recovery phrase, the wallet
          and every message are gone for good.
        </p>

        <form className="stack" onSubmit={handleDestroy}>
          <label className="field">
            <span>Type {DELETE_CONFIRMATION} to confirm</span>
            <input
              type="text"
              autoComplete="off"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
            />
          </label>

          {deleteError ? (
            <p className="form-error" role="alert">
              {deleteError}
            </p>
          ) : null}

          <button type="submit" className="button button--danger">
            Delete vault
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="build-title">
        <h2 id="build-title">Build status</h2>
        <p className="muted small">
          All eight milestones are done: the vault, the crypto core, CI, the Sepolia wallet,
          encrypted messaging and pay-in-chat are built and tested, two browsers hold a sealed
          conversation over the real Waku network and settle a Sepolia payment inside it, the threat
          model is written down in docs/SECURITY.md, and the two-browser demo is recorded
          (docs/demo) for the v2.0.0 tag — and the wallet only ever touches testnet.
        </p>

        <ol className="milestones">
          {MILESTONES.map((milestone) => {
            const state = milestoneStatus(milestone.id)

            return (
              <li key={milestone.id} className={`milestone milestone--${state}`}>
                <span className="milestone-id">{String(milestone.id).padStart(2, '0')}</span>
                <span className="milestone-title">{milestone.title}</span>
                <span className="milestone-status">{state}</span>
              </li>
            )
          })}
        </ol>
      </section>
    </>
  )
}
