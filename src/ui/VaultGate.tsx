import { useState, type FormEvent } from 'react'

import { MIN_PASSWORD_LENGTH } from '../vault'
import { CONFIRM_WORD_INDICES, describeVaultError } from './gate-copy'
import { useVault } from './vault-context'

type GateStep = 'password' | 'backup' | 'confirm'

export interface VaultGateProps {
  /** True while the create flow is showing the recovery phrase steps. */
  readonly onFlowChange?: (active: boolean) => void
}

export function VaultGate({ onFlowChange }: VaultGateProps) {
  const { status, create, unlock } = useVault()
  const creating = status === 'empty'

  const [step, setStep] = useState<GateStep>('password')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const words = mnemonic?.split(' ') ?? []

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    if (creating && password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }

    setBusy(true)
    try {
      if (creating) {
        const created = await create(password)
        setMnemonic(created.mnemonic)
        onFlowChange?.(true)
        setStep('backup')
      } else {
        await unlock(password)
      }
    } catch (cause) {
      setError(describeVaultError(cause))
    } finally {
      setBusy(false)
      setPassword('')
      setConfirmation('')
    }
  }

  function handleBackupAcknowledged(): void {
    setError(null)
    setStep('confirm')
  }

  function handleConfirmSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)

    const matches = CONFIRM_WORD_INDICES.every(
      (wordIndex, position) => (answers[position] ?? '').trim().toLowerCase() === words[wordIndex],
    )

    if (!matches) {
      setError('Those words do not match the phrase. Check what you wrote down and try again.')
      return
    }

    setMnemonic(null)
    setAnswers(['', '', ''])
    setStep('password')
    onFlowChange?.(false)
  }

  if (step === 'backup') {
    return (
      <section className="card" aria-labelledby="backup-title">
        <h2 id="backup-title">Write down your recovery phrase</h2>
        <p className="muted">
          These {words.length} words are the only way back into this vault. They restore your wallet
          and your chats. Oblivion does not keep a copy and cannot reset them.
        </p>

        <ol className="word-grid" data-testid="recovery-phrase">
          {words.map((word, index) => (
            <li key={`${word}-${index}`}>
              <span className="word-index">{index + 1}</span>
              <span className="word-text">{word}</span>
            </li>
          ))}
        </ol>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="button" className="button button--primary" onClick={handleBackupAcknowledged}>
          I have written it down
        </button>
      </section>
    )
  }

  if (step === 'confirm') {
    return (
      <section className="card" aria-labelledby="confirm-title">
        <h2 id="confirm-title">Confirm three words</h2>
        <p className="muted">
          Type those words from your written copy to prove the backup works. If you lose the phrase
          now, nobody can recover this vault.
        </p>

        <form className="stack" onSubmit={handleConfirmSubmit}>
          {CONFIRM_WORD_INDICES.map((wordIndex, position) => (
            <label key={wordIndex} className="field">
              <span>Word #{wordIndex + 1}</span>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={answers[position] ?? ''}
                onChange={(event) => {
                  const next = [...answers]
                  next[position] = event.target.value
                  setAnswers(next)
                }}
              />
            </label>
          ))}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="button button--primary">
            Confirm and open my vault
          </button>
        </form>
      </section>
    )
  }

  return (
    <section className="card" aria-labelledby="gate-title">
      <h2 id="gate-title">{creating ? 'Create your vault' : 'Unlock your vault'}</h2>
      <p className="muted">
        {creating
          ? 'One password derives the key that encrypts everything on this device: your messages, your contacts and your Sepolia wallet.'
          : 'Your vault is locked. The key exists only while this tab has your password.'}
      </p>

      <form className="stack" onSubmit={handlePasswordSubmit}>
        <label className="field">
          <span>{creating ? 'New password' : 'Password'}</span>
          <input
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {creating ? (
          <label className="field">
            <span>Repeat password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </label>
        ) : null}

        {creating ? (
          <p className="muted small">
            At least {MIN_PASSWORD_LENGTH} characters. Argon2id turns it into a vault key; there is
            no server and no recovery link.
          </p>
        ) : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Working…' : creating ? 'Create vault' : 'Unlock'}
        </button>
      </form>
    </section>
  )
}
