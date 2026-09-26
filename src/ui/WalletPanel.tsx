import { useState, type FormEvent } from 'react'
import { formatGwei } from 'viem'

import { SAFETY_CHAIN_NOTE } from '../safety'
import { SEPOLIA_CHAIN_ID, explorerTransactionUrl } from '../wallet/chain'
import {
  ethereumPaymentUri,
  formatEth,
  formatTokenAmount,
  parseEthInput,
  resolveTransferRequest,
  shortenAddress,
} from '../wallet/format'
import { DEFAULT_HISTORY_LOOKBACK_BLOCKS } from '../wallet/service'
import type { FeeEstimate, TransactionStatus, WalletTransaction } from '../wallet/types'
import { CopyButton } from './CopyButton'
import { QrCode } from './QrCode'
import { describeWalletError, useWallet } from './wallet-context'

/**
 * The Sepolia wallet. Every read goes through the wallet context, which builds
 * its service over the unlocked vault and refuses any endpoint that is not
 * Sepolia — including mainnet, which gets its own refusal notice.
 */
export function WalletPanel() {
  const { state, error, refresh } = useWallet()

  return (
    <section className="card" aria-labelledby="wallet-title">
      <header className="wallet-head">
        <div>
          <h2 id="wallet-title">Testnet wallet</h2>
          <p className="muted small">
            One account, derived from the vault mnemonic, locked to chain ID {SEPOLIA_CHAIN_ID}.
            Nothing here can touch mainnet.
          </p>
        </div>
        <div className="wallet-head-actions">
          <span className="pill">Sepolia</span>
          <button
            type="button"
            className="button"
            disabled={state === 'loading'}
            onClick={() => {
              void refresh()
            }}
          >
            {state === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? <WalletErrorNotice code={error.code} message={error.message} /> : null}

      <div className="wallet-grid">
        <BalanceCard />
        <ReceiveCard />
        <SendCard />
        <HistoryCard />
        <TokensCard />
      </div>
    </section>
  )
}

export interface WalletErrorNoticeProps {
  readonly code: string
  readonly message: string
}

export function WalletErrorNotice({ code, message }: WalletErrorNoticeProps) {
  return (
    <p className="form-error" role="alert" data-testid="wallet-error" data-wallet-error-code={code}>
      {message}
    </p>
  )
}

function BalanceCard() {
  const { address, balanceWei, state, rpcUrl, canSend } = useWallet()

  return (
    <section className="wallet-card" aria-labelledby="wallet-balance-title">
      <h3 id="wallet-balance-title">Balance</h3>

      <p className="balance" data-testid="wallet-balance">
        {balanceWei === null ? '—' : `${formatEth(balanceWei, { maxDecimals: 6 })} ETH`}
      </p>

      <dl className="facts">
        <dt>Address</dt>
        <dd className="mono" data-testid="wallet-address">
          {address}
        </dd>
        <dt>Reads through</dt>
        <dd className="mono small">{rpcUrl}</dd>
      </dl>

      <div className="wallet-actions">
        <CopyButton value={address} subject="address" />
        {state === 'loading' ? <span className="muted small">Reading the chain…</span> : null}
        {!canSend ? (
          <span className="muted small">Read-only session: unlock the vault to sign.</span>
        ) : null}
      </div>

      <p className="muted small">{SAFETY_CHAIN_NOTE}</p>
    </section>
  )
}

function ReceiveCard() {
  const { address } = useWallet()
  const [requested, setRequested] = useState('')

  let valueWei: bigint | undefined
  let error: string | null = null

  if (requested.trim().length > 0) {
    try {
      valueWei = parseEthInput(requested)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'that amount is not valid'
    }
  }

  const uri = ethereumPaymentUri(address, valueWei === undefined ? {} : { valueWei })

  return (
    <section className="wallet-card" aria-labelledby="wallet-receive-title">
      <h3 id="wallet-receive-title">Receive</h3>

      <QrCode
        value={uri}
        label={
          valueWei === undefined
            ? `Receive ETH at ${address} on Sepolia`
            : `Receive ${formatEth(valueWei)} ETH at ${address} on Sepolia`
        }
        size={176}
      />

      <label className="field">
        <span>Amount to request (ETH, optional)</span>
        <input
          value={requested}
          inputMode="decimal"
          placeholder="0.01"
          onChange={(event) => {
            setRequested(event.target.value)
          }}
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}

      <p className="muted small mono" data-testid="payment-uri">
        {uri}
      </p>

      <div className="wallet-actions">
        <CopyButton value={uri} subject="payment link" disabled={error !== null} />
        <CopyButton value={address} subject="address" />
      </div>

      <p className="muted small">
        This QR is an EIP-681 payment URI: it carries this address, the Sepolia chain id, and the
        amount once you type one. Another wallet scans it to send testnet ETH — no testnet ETH yet?
        A public Sepolia faucet will give you some.
      </p>
    </section>
  )
}

interface PendingTransfer {
  readonly to: string
  readonly valueWei: bigint
  readonly fee: FeeEstimate
}

function SendCard() {
  const { address, canSend, estimateSend, send, lastSent, checkTransaction } = useWallet()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [pending, setPending] = useState<PendingTransfer | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleReview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)
    setPending(null)
    setBusy(true)

    try {
      const { to, valueWei } = resolveTransferRequest(recipient, amount)
      const fee = await estimateSend({ from: address, to, valueWei })
      setPending({ to, valueWei, fee })
    } catch (cause) {
      setMessage(describeWalletError(cause).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!pending) return

    setMessage(null)
    setBusy(true)

    try {
      await send({ from: address, to: pending.to as `0x${string}`, valueWei: pending.valueWei })
      setPending(null)
      setRecipient('')
      setAmount('')
    } catch (cause) {
      setMessage(describeWalletError(cause).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wallet-card" aria-labelledby="wallet-send-title">
      <h3 id="wallet-send-title">Send ETH</h3>

      <form
        className="stack"
        onSubmit={(event) => {
          void handleReview(event)
        }}
      >
        <label className="field">
          <span>Recipient address or payment link</span>
          <input
            value={recipient}
            placeholder={`0x… or ethereum:0x…@${SEPOLIA_CHAIN_ID}`}
            autoComplete="off"
            onChange={(event) => {
              setRecipient(event.target.value)
              setPending(null)
            }}
          />
        </label>

        <label className="field">
          <span>Amount (ETH)</span>
          <input
            value={amount}
            inputMode="decimal"
            placeholder="0.001"
            autoComplete="off"
            onChange={(event) => {
              setAmount(event.target.value)
              setPending(null)
            }}
          />
        </label>

        <button type="submit" className="button" disabled={busy || !canSend}>
          {busy && !pending ? 'Estimating…' : 'Review transfer'}
        </button>
      </form>

      {!canSend ? (
        <p className="muted small">A locked vault has no signing key, so this form cannot send.</p>
      ) : null}

      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}

      {pending ? (
        <div className="review" data-testid="send-review">
          <h4>Check this before it goes out</h4>
          <dl className="facts">
            <dt>To</dt>
            <dd className="mono">{pending.to}</dd>
            <dt>Amount</dt>
            <dd>{formatEth(pending.valueWei)} ETH</dd>
            <dt>Estimated gas</dt>
            <dd>{pending.fee.gas.toString()}</dd>
            <dt>Max fee per gas</dt>
            <dd>{formatGwei(pending.fee.maxFeePerGasWei)} gwei</dd>
            <dt>Priority fee</dt>
            <dd>{formatGwei(pending.fee.maxPriorityFeePerGasWei)} gwei</dd>
            <dt>Worst-case fee</dt>
            <dd data-testid="estimated-fee">
              {formatEth(pending.fee.estimatedFeeWei, { maxDecimals: 9 })} ETH
            </dd>
            <dt>Total needed</dt>
            <dd>{formatEth(pending.fee.totalRequiredWei, { maxDecimals: 9 })} ETH</dd>
          </dl>

          <div className="wallet-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => {
                void handleConfirm()
              }}
            >
              {busy ? 'Sending…' : `Send ${formatEth(pending.valueWei)} ETH`}
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => {
                setPending(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {lastSent ? (
        <div className="review" data-testid="sent-transaction">
          <h4>Last transaction</h4>
          <dl className="facts">
            <dt>Hash</dt>
            <dd className="mono">{lastSent.hash}</dd>
            <dt>Fee cap</dt>
            <dd>{formatEth(lastSent.feeWei, { maxDecimals: 9 })} ETH</dd>
            <dt>Status</dt>
            <dd data-testid="transaction-status">{describeStatus(lastSent.status)}</dd>
          </dl>
          <div className="wallet-actions">
            <a
              className="button"
              href={explorerTransactionUrl(lastSent.hash)}
              target="_blank"
              rel="noreferrer"
            >
              Open in explorer
            </a>
            <button
              type="button"
              className="button"
              onClick={() => {
                void checkTransaction(lastSent.hash)
              }}
            >
              Check status
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function HistoryCard() {
  const { history, state, refresh } = useWallet()

  return (
    <section className="wallet-card" aria-labelledby="wallet-history-title">
      <header className="wallet-head">
        <h3 id="wallet-history-title">Recent activity</h3>
        <button
          type="button"
          className="button"
          disabled={state === 'loading'}
          onClick={() => {
            void refresh()
          }}
        >
          Scan again
        </button>
      </header>

      <p className="muted small">
        Scans the last {DEFAULT_HISTORY_LOOKBACK_BLOCKS} blocks over public RPC. There is no indexer
        behind this, so older transactions are not listed.
      </p>

      {history.length === 0 ? (
        <p className="muted small" data-testid="history-empty">
          Nothing in the last {DEFAULT_HISTORY_LOOKBACK_BLOCKS} blocks involved this address.
        </p>
      ) : (
        <ul className="tx-list" data-testid="history-list">
          {history.map((entry) => (
            <TransactionRow key={entry.hash} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TransactionRow({ entry }: { readonly entry: WalletTransaction }) {
  const counterparty = entry.direction === 'out' ? entry.to : entry.from

  return (
    <li className="tx-row">
      <span className={`tx-direction tx-direction--${entry.direction}`}>
        {entry.direction === 'out' ? 'Sent' : entry.direction === 'in' ? 'Received' : 'Self'}
      </span>
      <span className="mono">{formatEth(entry.valueWei, { maxDecimals: 6 })} ETH</span>
      <span className="mono small">
        {counterparty === null ? 'contract creation' : shortenAddress(counterparty)}
      </span>
      <span className="muted small">block {entry.blockNumber.toString()}</span>
      <a
        className="mono small"
        href={explorerTransactionUrl(entry.hash)}
        target="_blank"
        rel="noreferrer"
      >
        {shortenAddress(entry.hash, 10, 6)}
      </a>
    </li>
  )
}

function TokensCard() {
  const { tokens, tokenBalances, addToken, removeToken, canSend } = useWallet()
  const [address, setAddress] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setMessage(null)
    setBusy(true)

    try {
      const token = await addToken(address)
      setAddress('')
      setMessage(`Added ${token.symbol}.`)
    } catch (cause) {
      setMessage(describeWalletError(cause).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="wallet-card" aria-labelledby="wallet-tokens-title">
      <h3 id="wallet-tokens-title">Tokens (ERC-20)</h3>

      <form
        className="stack"
        onSubmit={(event) => {
          void handleAdd(event)
        }}
      >
        <label className="field">
          <span>Token contract address</span>
          <input
            value={address}
            placeholder="0x…"
            autoComplete="off"
            onChange={(event) => {
              setAddress(event.target.value)
            }}
          />
        </label>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Reading token…' : 'Add token'}
        </button>
      </form>

      {message ? <p className="form-note">{message}</p> : null}

      {tokens.length === 0 ? (
        <p className="muted small" data-testid="tokens-empty">
          No tokens watched yet. Add an ERC-20 address and its name, symbol and decimals are read
          from the contract before anything is saved.
        </p>
      ) : (
        <ul className="tx-list" data-testid="token-list">
          {tokens.map((token) => {
            const balance = tokenBalances.find(
              (entry) => entry.token.address.toLowerCase() === token.address.toLowerCase(),
            )

            return (
              <li key={token.address} className="tx-row">
                <span>
                  <strong>{token.symbol}</strong> <span className="muted small">{token.name}</span>
                </span>
                <span className="mono">
                  {balance ? formatTokenAmount(balance.balanceWei, token) : '…'}
                </span>
                <span className="mono small">{shortenAddress(token.address)}</span>
                <button
                  type="button"
                  className="button"
                  disabled={!canSend}
                  onClick={() => {
                    void removeToken(token.address)
                  }}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="muted small">
        Token balances are contract calls, not a price feed: Oblivion shows amounts and never values
        them in fiat.
      </p>
    </section>
  )
}

function describeStatus(status: TransactionStatus | null): string {
  if (status?.state === 'confirmed') {
    return `confirmed in block ${status.blockNumber?.toString() ?? 'unknown'}`
  }

  if (status?.state === 'failed') return 'failed on chain'

  return 'pending — not yet mined'
}
