import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { deriveMessagingIdentity, publicKeyFingerprint, type HexString } from '../crypto/keys'
import type { ContactRecord, MessageRecord, PaymentRecord, VaultDocument } from '../vault/schema'
import { MessagingError } from '../messaging/errors'
import { contentTopicFor, conversationIdFor, parseContactIdentity } from '../messaging/identity'
import { createLocalTransport } from '../messaging/local-network'
import {
  decodePaymentBody,
  type PaymentReceipt,
  type PaymentReceiptStatus,
  type PaymentRequest,
  type PaymentRequestDraft,
} from '../messaging/payments'
import { MessagingService, type ReceivedMessage } from '../messaging/service'
import type { MessageTransport } from '../messaging/transport'
import { useVault } from './vault-context'

/** Where messages travel. `local` never leaves this browser tab. */
export type MessagingTransportMode = 'local' | 'waku'

export type MessagingConnection = 'offline' | 'connecting' | 'online' | 'failed'

/** Everything the panel needs to render one conversation. */
export interface ConversationView {
  readonly conversationId: string
  readonly contact: ContactRecord
  readonly topic: string
  readonly messages: readonly MessageRecord[]
}

export interface MessagingContextValue {
  readonly identityString: string
  readonly identityPublicKey: HexString
  readonly fingerprint: string
  readonly mode: MessagingTransportMode
  readonly connection: MessagingConnection
  readonly error: string | null
  readonly contacts: readonly ContactRecord[]
  readonly conversations: readonly ConversationView[]
  /** The pay-in-chat ledger: what was asked for, and how it ended. */
  readonly payments: readonly PaymentRecord[]
  /** Messages already in the vault that belong to no known contact. */
  readonly orphanMessages: number
  connect: (mode: MessagingTransportMode) => Promise<void>
  addContact: (identity: string, label: string) => Promise<ContactRecord>
  removeContact: (id: string) => Promise<void>
  sendMessage: (contactPublicKey: HexString, body: string) => Promise<void>
  /** Asks a contact to pay: sealed, published, and recorded in the vault. */
  requestPayment: (
    contactPublicKey: HexString,
    draft: PaymentRequestDraft,
  ) => Promise<PaymentRequest>
  /**
   * Posts the outcome of a request back into the thread. The wallet does the
   * paying; this only reports what happened, so the chat never holds a key.
   */
  settlePayment: (
    contactPublicKey: HexString,
    input: {
      readonly requestId: string
      readonly status: PaymentReceiptStatus
      readonly txHash?: HexString | null
    },
  ) => Promise<PaymentReceipt>
}

const MessagingContext = createContext<MessagingContextValue | null>(null)

export interface MessagingProviderProps {
  readonly children: ReactNode
  /** Test seam: inject a transport (usually one from an `InMemoryNetwork`). */
  readonly transportFactory?: (
    mode: MessagingTransportMode,
  ) => MessageTransport | Promise<MessageTransport>
}

export function MessagingProvider({ children, transportFactory }: MessagingProviderProps) {
  const { status, document, identity, update } = useVault()

  // Derived from the mnemonic rather than the whole document: any vault write
  // (every stored message) must not look like a new identity, or the transport
  // would be torn down and rebuilt on every message.
  const mnemonic = status === 'unlocked' ? (document?.identity.mnemonic ?? null) : null

  const messagingIdentity = useMemo(
    () => (mnemonic ? deriveMessagingIdentity(mnemonic) : null),
    [mnemonic],
  )

  const contacts = useMemo(() => document?.contacts ?? [], [document])
  const messages = useMemo(() => document?.messages ?? [], [document])
  const payments = useMemo(() => document?.payments ?? [], [document])

  const [service, setService] = useState<MessagingService | null>(null)
  const [mode, setMode] = useState<MessagingTransportMode>('local')
  const [connection, setConnection] = useState<MessagingConnection>('offline')
  const [error, setError] = useState<string | null>(null)

  /**
   * Messages that arrive are written straight into the vault, which is the only
   * place plaintext is kept. `update` is a function of the current document, so
   * two arrivals in the same tick cannot drop each other.
   */
  const storeInbound = useCallback(
    async (message: ReceivedMessage) => {
      // Already validated on receipt; parsed here to keep the ledger in step with
      // the thread. `null` means an ordinary chat message.
      const payment = decodePaymentBody(message.kind, message.body)

      await update((current) => {
        const stored: VaultDocument = {
          ...current,
          messages: appendMessage(current, {
            id: messageId(message.conversationId, message.sentAt, message.body),
            conversationId: message.conversationId,
            direction: 'inbound',
            body: message.body,
            sentAt: message.sentAt,
            kind: message.kind,
            ...(payment ? { paymentId: paymentIdOf(payment) } : {}),
          }),
        }

        if (payment?.kind === 'payment-request') {
          return {
            ...stored,
            payments: upsertPayment(current.payments, {
              id: payment.request.requestId,
              conversationId: message.conversationId,
              // Somebody asked *me* to pay. Their address is the one the request
              // names; the app still does not know mine from here, and says so.
              role: 'received',
              amountWei: payment.request.amountWei.toString(),
              from: null,
              to: payment.request.payTo,
              status: 'requested',
              requestedAt: message.sentAt,
            }),
          }
        }

        if (payment?.kind === 'payment-receipt') {
          // Only an existing row is updated: a receipt for a request this vault
          // never held stays a message in the thread rather than inventing one.
          return { ...stored, payments: applySettlement(current.payments, payment.receipt) }
        }

        return stored
      })
    },
    [update],
  )

  const connect = useCallback(
    async (nextMode: MessagingTransportMode) => {
      if (!messagingIdentity) return

      setConnection('connecting')
      setError(null)

      try {
        const transport = transportFactory
          ? await transportFactory(nextMode)
          : nextMode === 'local'
            ? createLocalTransport()
            : await loadWakuTransport()

        const next = new MessagingService({
          transport,
          identity: {
            privateKey: messagingIdentity.privateKey,
            publicKey: messagingIdentity.publicKey,
          },
          onMessage: storeInbound,
          onRejected: (cause) => {
            setError(cause.message)
          },
        })

        await next.start()

        setService(next)
        setMode(nextMode)
        setConnection('online')
      } catch (cause) {
        setService(null)
        setConnection('failed')
        setError(describeMessagingError(cause))
      }
    },
    [messagingIdentity, storeInbound, transportFactory],
  )

  // The app starts in local mode: a first run with no network still works, and
  // connecting to Waku stays an explicit choice the user makes.
  useEffect(() => {
    void (async () => {
      await connect('local')
    })()
  }, [connect])

  // Stopping the old service is what stops the old subscriptions.
  useEffect(() => {
    if (!service) return

    return () => {
      void service.stop()
    }
  }, [service])

  // Every contact is watched, and watching twice is a no-op.
  useEffect(() => {
    if (!service) return

    void (async () => {
      for (const contact of contacts) {
        await service.watch(contact.publicKey).catch(() => undefined)
      }
    })()
  }, [contacts, service])

  const addContact = useCallback(
    async (identityValue: string, label: string) => {
      if (!messagingIdentity) {
        throw new MessagingError('transport-not-started', 'unlock the vault first')
      }

      const parsed = await parseContactIdentity(identityValue)
      const trimmedLabel = label.trim().length > 0 ? label.trim() : parsed.fingerprint

      if (parsed.publicKey === messagingIdentity.publicKey) {
        throw new MessagingError('self-contact', 'that is your own identity')
      }

      const record: ContactRecord = {
        id: `contact-${parsed.fingerprint}`,
        label: trimmedLabel,
        identity: parsed.identity,
        publicKey: parsed.publicKey,
        addedAt: new Date().toISOString(),
      }

      await update((current) => ({
        ...current,
        contacts: [...current.contacts.filter((existing) => existing.id !== record.id), record],
      }))

      await service?.watch(parsed.publicKey).catch(() => undefined)

      return record
    },
    [messagingIdentity, service, update],
  )

  const removeContact = useCallback(
    async (id: string) => {
      const going = contacts.find((contact) => contact.id === id)

      await update((current) => ({
        ...current,
        contacts: current.contacts.filter((contact) => contact.id !== id),
      }))

      // Removing a contact stops listening to them as well, which is what the
      // person clicking Remove expects.
      if (going) await service?.unwatch(going.publicKey).catch(() => undefined)
    },
    [contacts, service, update],
  )

  const sendMessage = useCallback(
    async (contactPublicKey: HexString, body: string) => {
      if (!messagingIdentity) {
        throw new MessagingError('transport-not-started', 'unlock the vault first')
      }

      if (!service) {
        throw new MessagingError('transport-not-started', 'connect a transport first')
      }

      const sent = await service.sendText(contactPublicKey, body)

      await update((current) => ({
        ...current,
        messages: appendMessage(current, {
          id: messageId(sent.conversationId, sent.sentAt, sent.body),
          conversationId: sent.conversationId,
          direction: 'outbound',
          body: sent.body,
          sentAt: sent.sentAt,
          kind: 'text',
        }),
      }))
    },
    [messagingIdentity, service, update],
  )

  const requestPayment = useCallback(
    async (contactPublicKey: HexString, draft: PaymentRequestDraft) => {
      if (!messagingIdentity) {
        throw new MessagingError('transport-not-started', 'unlock the vault first')
      }

      if (!service) {
        throw new MessagingError('transport-not-started', 'connect a transport first')
      }

      const sent = await service.sendPaymentRequest(contactPublicKey, draft)

      await update((current) => ({
        ...current,
        messages: appendMessage(current, {
          id: messageId(sent.conversationId, sent.sentAt, sent.body),
          conversationId: sent.conversationId,
          direction: 'outbound',
          body: sent.body,
          sentAt: sent.sentAt,
          kind: 'payment-request',
          paymentId: sent.request.requestId,
        }),
        payments: upsertPayment(current.payments, {
          id: sent.request.requestId,
          conversationId: sent.conversationId,
          role: 'requested',
          amountWei: sent.request.amountWei.toString(),
          from: null,
          to: sent.request.payTo,
          status: 'requested',
          requestedAt: sent.sentAt,
        }),
      }))

      return sent.request
    },
    [messagingIdentity, service, update],
  )

  const settlePayment = useCallback(
    async (
      contactPublicKey: HexString,
      input: {
        readonly requestId: string
        readonly status: PaymentReceiptStatus
        readonly txHash?: HexString | null
      },
    ) => {
      if (!service) {
        throw new MessagingError('transport-not-started', 'connect a transport first')
      }

      const sent = await service.sendPaymentReceipt(contactPublicKey, input)

      await update((current) => ({
        ...current,
        messages: appendMessage(current, {
          id: messageId(sent.conversationId, sent.sentAt, sent.body),
          conversationId: sent.conversationId,
          direction: 'outbound',
          body: sent.body,
          sentAt: sent.sentAt,
          kind: 'payment-receipt',
          paymentId: input.requestId,
        }),
        payments: applySettlement(current.payments, sent.receipt),
      }))

      return sent.receipt
    },
    [service, update],
  )

  const value = useMemo<MessagingContextValue | null>(() => {
    if (!messagingIdentity) return null

    const conversations: ConversationView[] = contacts.map((contact) => {
      const conversationId = conversationIdFor(messagingIdentity.publicKey, contact.publicKey)

      return {
        conversationId,
        contact,
        topic: contentTopicFor(conversationId),
        messages: messages.filter((message) => message.conversationId === conversationId),
      }
    })

    const known = new Set(conversations.map((conversation) => conversation.conversationId))

    return {
      identityString: identity?.identityString ?? '',
      identityPublicKey: messagingIdentity.publicKey,
      fingerprint: publicKeyFingerprint(messagingIdentity.publicKey),
      mode,
      connection,
      error,
      contacts,
      conversations,
      payments,
      orphanMessages: messages.filter((message) => !known.has(message.conversationId)).length,
      connect,
      addContact,
      removeContact,
      sendMessage,
      requestPayment,
      settlePayment,
    }
  }, [
    addContact,
    connect,
    connection,
    contacts,
    error,
    identity,
    messages,
    messagingIdentity,
    mode,
    payments,
    removeContact,
    requestPayment,
    sendMessage,
    settlePayment,
  ])

  if (!value) return null

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>
}

/** The Waku adapter is imported on demand, so the SDK never lands in the main bundle. */
async function loadWakuTransport(): Promise<MessageTransport> {
  const { createWakuTransport } = await import('../messaging/waku')
  return createWakuTransport()
}

function appendMessage(current: VaultDocument, record: MessageRecord): readonly MessageRecord[] {
  if (current.messages.some((existing) => existing.id === record.id)) return current.messages
  return [...current.messages, record]
}

/** Adds a payment row, or merges into the one already there for that id. */
function upsertPayment(
  current: readonly PaymentRecord[],
  record: PaymentRecord,
): readonly PaymentRecord[] {
  if (!current.some((entry) => entry.id === record.id)) return [...current, record]

  return current.map((entry) => (entry.id === record.id ? { ...entry, ...record } : entry))
}

/**
 * Applies a receipt to the ledger row it refers to, and only that row: a
 * payment id nobody is holding is left alone rather than conjured into a record
 * with invented addresses.
 */
function applySettlement(
  current: readonly PaymentRecord[],
  receipt: PaymentReceipt,
): readonly PaymentRecord[] {
  return current.map((entry) => {
    if (entry.id !== receipt.requestId) return entry

    return {
      ...entry,
      status: receipt.status,
      ...(receipt.txHash ? { txHash: receipt.txHash } : {}),
      ...(receipt.status === 'paid' ? { paidAt: receipt.settledAt } : {}),
    }
  })
}

function paymentIdOf(payment: NonNullable<ReturnType<typeof decodePaymentBody>>): string {
  return payment.kind === 'payment-request' ? payment.request.requestId : payment.receipt.requestId
}

function messageId(conversationId: string, sentAt: string, body: string): string {
  // Stable per (conversation, timestamp, body): a frame delivered twice — which
  // publish/subscribe transports do — is stored once.
  return `message-${conversationId}-${sentAt}-${body.length}-${body.charCodeAt(0)}`
}

export function describeMessagingError(cause: unknown): string {
  if (cause instanceof MessagingError || cause instanceof Error) return cause.message
  return 'the messaging transport failed'
}

// The hook lives beside the provider on purpose: they share the private context.
// eslint-disable-next-line react-refresh/only-export-components
export function useMessaging(): MessagingContextValue {
  const value = useContext(MessagingContext)

  if (!value) {
    throw new Error('useMessaging must be used inside a MessagingProvider')
  }

  return value
}
