import { useState, type FormEvent } from 'react'

import type { ContactRecord, MessageRecord } from '../vault/schema'
import { MAX_MESSAGE_LENGTH } from '../messaging/service'
import { CopyButton } from './CopyButton'
import { QrCode } from './QrCode'
import {
  describeMessagingError,
  useMessaging,
  type MessagingTransportMode,
} from './messaging-context'

/**
 * Messages. The connection status is part of the furniture, not a detail: with
 * local delivery on, nothing leaves the tab, and the panel says so.
 */
export function MessagingPanel() {
  const {
    identityString,
    fingerprint,
    mode,
    connection,
    error,
    conversations,
    orphanMessages,
    connect,
  } = useMessaging()

  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const active =
    conversations.find((conversation) => conversation.conversationId === selected) ??
    conversations[0] ??
    null

  return (
    <section className="card" aria-labelledby="messaging-title">
      <header className="wallet-head">
        <div>
          <h2 id="messaging-title">Messages</h2>
          <p className="muted small">
            Direct messages are sealed to the recipient&apos;s key before they reach the network.
            The relay sees traffic, never text.
          </p>
        </div>
        <div className="wallet-head-actions">
          <span className="pill" data-testid="connection-pill">
            {describeConnection(mode, connection)}
          </span>
          <ConnectButton
            mode="local"
            label={mode === 'local' && connection === 'online' ? 'Restart local' : 'Use local mode'}
            disabled={connection === 'connecting'}
            onConnect={async (next) => {
              setBusy(true)
              await connect(next)
              setBusy(false)
            }}
          />
          <ConnectButton
            mode="waku"
            label="Connect to Waku"
            disabled={connection === 'connecting' || busy}
            onConnect={async (next) => {
              setBusy(true)
              await connect(next)
              setBusy(false)
            }}
          />
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert" data-testid="messaging-error">
          {error}
        </p>
      ) : null}

      <div className="wallet-grid">
        <IdentityCard identityString={identityString} fingerprint={fingerprint} />
        <ContactsCard
          conversations={conversations}
          selected={active?.conversationId ?? null}
          onSelect={setSelected}
        />
        <ConversationCard conversation={active} />
      </div>

      <p className="muted small">
        {orphanMessages > 0
          ? `${orphanMessages} stored message${orphanMessages === 1 ? '' : 's'} belong to a contact this vault no longer holds.`
          : 'Messages are stored in the vault, encrypted with everything else.'}
      </p>
    </section>
  )
}

function ConnectButton({
  mode,
  label,
  disabled,
  onConnect,
}: {
  readonly mode: MessagingTransportMode
  readonly label: string
  readonly disabled: boolean
  readonly onConnect: (mode: MessagingTransportMode) => Promise<void>
}) {
  return (
    <button
      type="button"
      className="button"
      disabled={disabled}
      onClick={() => {
        void onConnect(mode)
      }}
    >
      {label}
    </button>
  )
}

function IdentityCard({
  identityString,
  fingerprint,
}: {
  readonly identityString: string
  readonly fingerprint: string
}) {
  return (
    <section className="wallet-card" aria-labelledby="messaging-identity-title">
      <h3 id="messaging-identity-title">Your chat identity</h3>

      <QrCode
        value={identityString}
        label={`Your Oblivion chat identity ${fingerprint}`}
        size={152}
      />

      <dl className="facts">
        <dt>Identity</dt>
        <dd className="mono small" data-testid="messaging-identity">
          {identityString}
        </dd>
        <dt>Fingerprint</dt>
        <dd className="mono" data-testid="messaging-fingerprint">
          {fingerprint}
        </dd>
      </dl>

      <div className="wallet-actions">
        <CopyButton value={identityString} subject="identity" />
      </div>

      <p className="muted small">
        This key is unrelated to your wallet address: it sits on a different derivation path. Read
        the fingerprint out loud when you exchange it, so a swapped QR is noticed.
      </p>
    </section>
  )
}

function ContactsCard({
  conversations,
  selected,
  onSelect,
}: {
  readonly conversations: readonly {
    readonly conversationId: string
    readonly contact: ContactRecord
    readonly messages: readonly MessageRecord[]
  }[]
  readonly selected: string | null
  readonly onSelect: (conversationId: string) => void
}) {
  const { addContact, removeContact } = useMessaging()

  const [identity, setIdentity] = useState('')
  const [label, setLabel] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)
    setBusy(true)

    try {
      const contact = await addContact(identity, label)
      setIdentity('')
      setLabel('')
      setMessage(`Added ${contact.label}.`)
    } catch (cause) {
      setMessage(describeMessagingError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wallet-card" aria-labelledby="messaging-contacts-title">
      <h3 id="messaging-contacts-title">Contacts</h3>

      <form
        className="stack"
        onSubmit={(event) => {
          void handleAdd(event)
        }}
      >
        <label className="field">
          <span>Contact identity</span>
          <input
            value={identity}
            placeholder="oblivion1… or 0x02…"
            autoComplete="off"
            onChange={(event) => {
              setIdentity(event.target.value)
            }}
          />
        </label>
        <label className="field">
          <span>Name</span>
          <input
            value={label}
            placeholder="Ada"
            autoComplete="off"
            onChange={(event) => {
              setLabel(event.target.value)
            }}
          />
        </label>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Checking the key…' : 'Add contact'}
        </button>
      </form>

      {message ? (
        <p className="form-note" role="status">
          {message}
        </p>
      ) : null}

      {conversations.length === 0 ? (
        <p className="muted small" data-testid="contacts-empty">
          No contacts yet. You need their identity string (or QR) before you can write to them.
        </p>
      ) : (
        <ul className="tx-list" data-testid="contact-list">
          {conversations.map((conversation) => (
            <li key={conversation.conversationId} className="tx-row">
              <button
                type="button"
                className={`button${conversation.conversationId === selected ? ' button--primary' : ''}`}
                onClick={() => {
                  onSelect(conversation.conversationId)
                }}
              >
                {conversation.contact.label}
              </button>
              <span className="muted small mono">{conversation.contact.id.slice(-9)}</span>
              <span className="muted small">{conversation.messages.length} message(s)</span>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  void removeContact(conversation.contact.id)
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ConversationCard({
  conversation,
}: {
  readonly conversation: {
    readonly conversationId: string
    readonly contact: ContactRecord
    readonly topic: string
    readonly messages: readonly MessageRecord[]
  } | null
}) {
  const { sendMessage, connection } = useMessaging()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!conversation) {
    return (
      <section className="wallet-card" aria-labelledby="messaging-thread-title">
        <h3 id="messaging-thread-title">Conversation</h3>
        <p className="muted small" data-testid="thread-empty">
          Add a contact to start a conversation.
        </p>
      </section>
    )
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!conversation) return

    setError(null)
    setBusy(true)

    try {
      await sendMessage(conversation.contact.publicKey, draft)
      setDraft('')
    } catch (cause) {
      setError(describeMessagingError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wallet-card" aria-labelledby="messaging-thread-title">
      <h3 id="messaging-thread-title">Conversation with {conversation.contact.label}</h3>
      <p className="muted small mono" data-testid="conversation-topic">
        {conversation.topic}
      </p>

      {conversation.messages.length === 0 ? (
        <p className="muted small" data-testid="thread-no-messages">
          Nothing said yet. Messages you send are sealed here and stored in the vault.
        </p>
      ) : (
        <ul className="message-list" data-testid="message-list">
          {conversation.messages.map((message) => (
            <li key={message.id} className={`message message--${message.direction}`}>
              <span className="message-meta">
                {message.direction === 'outbound' ? 'You' : conversation.contact.label} ·{' '}
                {message.sentAt.slice(11, 19)}Z
              </span>
              <span className="message-body">{message.body}</span>
            </li>
          ))}
        </ul>
      )}

      <form
        className="stack"
        onSubmit={(event) => {
          void handleSend(event)
        }}
      >
        <label className="field">
          <span>Message</span>
          <textarea
            value={draft}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Say something"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
          />
        </label>
        <button
          type="submit"
          className="button button--primary"
          disabled={busy || connection !== 'online' || draft.trim().length === 0}
        >
          {busy ? 'Sealing…' : 'Send'}
        </button>
      </form>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function describeConnection(mode: MessagingTransportMode, connection: string): string {
  if (connection === 'connecting') return 'Connecting…'
  if (connection === 'failed') return 'Not connected'
  if (connection !== 'online') return 'Offline'
  return mode === 'waku' ? 'Waku network' : 'Local only (this tab)'
}
