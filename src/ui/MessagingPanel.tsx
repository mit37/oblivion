import { useEffect, useState, type FormEvent } from 'react'
import { formatGwei } from 'viem'

import type { ContactRecord, MessageRecord, PaymentRecord } from '../vault/schema'
import {
  decodePaymentBody,
  MAX_PAYMENT_NOTE_LENGTH,
  type PaymentPayload,
} from '../messaging/payments'
import { MAX_MESSAGE_LENGTH } from '../messaging/service'
import { explorerTransactionUrl } from '../wallet/chain'
import { formatEth, parseEthInput, shortenAddress } from '../wallet/format'
import type { FeeEstimate } from '../wallet/types'
import { CopyButton } from './CopyButton'
import { QrCode } from './QrCode'
import {
  describeMessagingError,
  useMessaging,
  type MessagingTransportMode,
} from './messaging-context'
import { describeWalletError, useWallet } from './wallet-context'

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
            <MessageRow key={message.id} message={message} contact={conversation.contact} />
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

      <PaymentRequestForm contact={conversation.contact} />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

/** One message in the thread: ordinary text, or a payment card. */
function MessageRow({
  message,
  contact,
}: {
  readonly message: MessageRecord
  readonly contact: ContactRecord
}) {
  const payment = readPayment(message)

  return (
    <li
      key={message.id}
      className={`message message--${message.direction}${payment ? ' message--payment' : ''}`}
    >
      <span className="message-meta">
        {message.direction === 'outbound' ? 'You' : contact.label} · {message.sentAt.slice(11, 19)}Z
      </span>

      {payment ? (
        <PaymentCard payment={payment} contact={contact} direction={message.direction} />
      ) : (
        <span className="message-body">{message.body}</span>
      )}
    </li>
  )
}

/** A stored payment body, or `null` for text and for anything unreadable. */
function readPayment(message: MessageRecord): PaymentPayload | null {
  if (message.kind === 'text') return null

  try {
    return decodePaymentBody(message.kind, message.body)
  } catch {
    // A payment frame that does not parse is shown as what it literally is
    // rather than as a button that might pay somebody.
    return null
  }
}

/** Asks the other side for testnet ETH, naming this wallet as the payee. */
function PaymentRequestForm({ contact }: { readonly contact: ContactRecord }) {
  const { connection, requestPayment } = useMessaging()
  const { address, canSend } = useWallet()

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setStatus(null)
    setError(null)
    setBusy(true)

    try {
      const request = await requestPayment(contact.publicKey, {
        amountWei: parseEthInput(amount),
        payTo: address,
        note,
      })

      setStatus(`Asked ${contact.label} for ${formatEth(request.amountWei)} ETH.`)
      setAmount('')
      setNote('')
    } catch (cause) {
      setError(describeMessagingError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="stack payment-form"
      data-testid="payment-request-form"
      onSubmit={(event) => {
        void handleRequest(event)
      }}
    >
      <h4>Request testnet ETH</h4>
      <p className="muted small">
        The request travels sealed like any other message, and it names the address you want paying
        — this wallet, on Sepolia. Nothing moves until they confirm.
      </p>

      <label className="field">
        <span>Amount (ETH)</span>
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.001"
          autoComplete="off"
          data-testid="payment-request-amount"
          onChange={(event) => {
            setAmount(event.target.value)
          }}
        />
      </label>

      <label className="field">
        <span>What is it for (optional)</span>
        <input
          value={note}
          maxLength={MAX_PAYMENT_NOTE_LENGTH}
          placeholder="Split the faucet drops"
          autoComplete="off"
          data-testid="payment-request-note"
          onChange={(event) => {
            setNote(event.target.value)
          }}
        />
      </label>

      <button
        type="submit"
        className="button"
        disabled={busy || !canSend || connection !== 'online' || amount.trim().length === 0}
        data-testid="payment-request-submit"
      >
        {busy ? 'Sealing…' : 'Request payment'}
      </button>

      {status ? (
        <p className="form-note" role="status" data-testid="payment-request-status">
          {status}
        </p>
      ) : null}

      {error ? (
        <p className="form-error" role="alert" data-testid="payment-request-error">
          {error}
        </p>
      ) : null}
    </form>
  )
}

/**
 * A payment request or receipt, inside the thread.
 *
 * Reading a request is free; paying is one click, and the fee is fetched and
 * shown *before* that click rather than after it, so "one confirmation" never
 * means "one surprise". The wallet does the signing — this card holds no key.
 */
function PaymentCard({
  payment,
  contact,
  direction,
}: {
  readonly payment: PaymentPayload
  readonly contact: ContactRecord
  readonly direction: MessageRecord['direction']
}) {
  const { payments, settlePayment } = useMessaging()
  const { address, balanceWei, canSend, estimateSend, send } = useWallet()

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const requestId =
    payment.kind === 'payment-request' ? payment.request.requestId : payment.receipt.requestId
  const record = payments.find((entry) => entry.id === requestId) ?? null

  // The ledger is the source of truth once a receipt arrives; before that, an
  // inbound request is simply "waiting for you".
  const status = record?.status ?? 'requested'
  const payable =
    payment.kind === 'payment-request' && direction === 'inbound' && status === 'requested'

  return (
    <span className="payment" data-testid="payment-card" data-payment-kind={payment.kind}>
      {payment.kind === 'payment-request' ? (
        <PaymentRequestBody
          request={payment.request}
          status={status}
          record={record}
          direction={direction}
          contact={contact}
          payable={payable}
          error={error}
          busy={busy}
          address={address}
          balanceWei={balanceWei}
          canSend={canSend}
          estimateSend={estimateSend}
          send={send}
          onError={setError}
          onBusy={setBusy}
          settlePayment={settlePayment}
        />
      ) : (
        <>
          <span className="payment-line" data-testid="payment-receipt-status">
            {payment.receipt.status === 'paid'
              ? `${contact.label} paid this request.`
              : `${contact.label} declined this request.`}
          </span>
          {payment.receipt.txHash ? (
            <>
              <span className="mono small" data-testid="payment-receipt-hash">
                {payment.receipt.txHash}
              </span>
              <a
                className="button"
                href={explorerTransactionUrl(payment.receipt.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                Open in explorer
              </a>
            </>
          ) : null}
        </>
      )}
    </span>
  )
}

/**
 * The request half. Split out so the fee effect lives with the fields it reads
 * and the parent card stays a switch on the payload kind.
 */
function PaymentRequestBody({
  request,
  status,
  record,
  direction,
  contact,
  payable,
  error,
  busy,
  address,
  balanceWei,
  canSend,
  estimateSend,
  send,
  onError,
  onBusy,
  settlePayment,
}: {
  readonly request: Extract<PaymentPayload, { kind: 'payment-request' }>['request']
  readonly status: PaymentRecord['status']
  readonly record: PaymentRecord | null
  readonly direction: MessageRecord['direction']
  readonly contact: ContactRecord
  readonly payable: boolean
  readonly error: string | null
  readonly busy: boolean
  readonly address: string
  readonly balanceWei: bigint | null
  readonly canSend: boolean
  readonly estimateSend: ReturnType<typeof useWallet>['estimateSend']
  readonly send: ReturnType<typeof useWallet>['send']
  readonly onError: (message: string | null) => void
  readonly onBusy: (busy: boolean) => void
  readonly settlePayment: ReturnType<typeof useMessaging>['settlePayment']
}) {
  const [fee, setFee] = useState<FeeEstimate | null>(null)

  useEffect(() => {
    if (!payable || !canSend) return

    let cancelled = false

    void (async () => {
      try {
        const estimate = await estimateSend({
          from: address as `0x${string}`,
          to: request.payTo,
          valueWei: request.amountWei,
        })

        if (!cancelled) setFee(estimate)
      } catch (cause) {
        if (!cancelled) setFee(null)
        if (!cancelled) onError(describeWalletError(cause).message)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [address, canSend, estimateSend, onError, payable, request.amountWei, request.payTo])

  const short = balanceWei !== null && fee !== null && balanceWei < fee.totalRequiredWei

  async function handlePay(): Promise<void> {
    onError(null)
    onBusy(true)

    try {
      const sent = await send({
        from: address as `0x${string}`,
        to: request.payTo,
        valueWei: request.amountWei,
      })

      await settlePayment(contact.publicKey, {
        requestId: request.requestId,
        status: 'paid',
        txHash: sent.hash,
      })
    } catch (cause) {
      onError(describeWalletError(cause).message)
    } finally {
      onBusy(false)
    }
  }

  async function handleDecline(): Promise<void> {
    onError(null)
    onBusy(true)

    try {
      await settlePayment(contact.publicKey, { requestId: request.requestId, status: 'declined' })
    } catch (cause) {
      onError(describeMessagingError(cause))
    } finally {
      onBusy(false)
    }
  }

  return (
    <>
      <span className="payment-line">
        {direction === 'outbound'
          ? `You asked ${contact.label} for ${formatEth(request.amountWei)} ETH.`
          : `${contact.label} asks for ${formatEth(request.amountWei)} ETH.`}
      </span>

      <span className="mono small" data-testid="payment-payto">
        {request.payTo}
      </span>

      {request.note.length > 0 ? <span className="muted small">“{request.note}”</span> : null}

      <span className="muted small" data-testid="payment-status">
        {describePaymentStatus(status, direction)}
        {record?.txHash ? ` · ${shortenAddress(record.txHash)}` : ''}
      </span>

      {record?.txHash ? (
        <a
          className="button"
          href={explorerTransactionUrl(record.txHash)}
          target="_blank"
          rel="noreferrer"
        >
          Open in explorer
        </a>
      ) : null}

      {payable ? (
        <>
          <span className="muted small" data-testid="payment-fee">
            {fee === null
              ? 'Checking what the fee would be…'
              : `Worst-case fee ${formatEth(fee.estimatedFeeWei, { maxDecimals: 9 })} ETH (${fee.gas.toString()} gas at up to ${formatGwei(fee.maxFeePerGasWei)} gwei), so ${formatEth(fee.totalRequiredWei, { maxDecimals: 9 })} ETH has to be available.`}
          </span>

          <span className="wallet-actions">
            <button
              type="button"
              className="button button--primary"
              data-testid="payment-pay"
              disabled={busy || !canSend || fee === null || short}
              onClick={() => {
                void handlePay()
              }}
            >
              {busy ? 'Paying…' : `Pay ${formatEth(request.amountWei)} ETH`}
            </button>
            <button
              type="button"
              className="button"
              data-testid="payment-decline"
              disabled={busy}
              onClick={() => {
                void handleDecline()
              }}
            >
              Decline
            </button>
          </span>

          {short ? (
            <span className="muted small" data-testid="payment-shortfall">
              This wallet does not hold enough testnet ETH to cover the amount and the worst-case
              fee. A Sepolia faucet can send more to {shortenAddress(address)}.
            </span>
          ) : null}
        </>
      ) : null}

      {error ? (
        <span className="form-error" role="alert" data-testid="payment-error">
          {error}
        </span>
      ) : null}
    </>
  )
}

function describePaymentStatus(
  status: PaymentRecord['status'],
  direction: MessageRecord['direction'],
) {
  if (status === 'paid') return 'Paid.'
  if (status === 'declined') return 'Declined.'

  return direction === 'outbound' ? 'Waiting for them to pay.' : 'Waiting for you to pay.'
}

function describeConnection(mode: MessagingTransportMode, connection: string): string {
  if (connection === 'connecting') return 'Connecting…'
  if (connection === 'failed') return 'Not connected'
  if (connection !== 'online') return 'Offline'
  return mode === 'waku' ? 'Waku network' : 'Local only (this tab)'
}
