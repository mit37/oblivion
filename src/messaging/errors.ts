export type MessagingErrorCode =
  | 'invalid-identity'
  | 'invalid-envelope'
  | 'invalid-payment'
  | 'wrong-conversation'
  | 'unknown-sender'
  | 'self-contact'
  | 'not-watching'
  | 'transport-not-started'
  | 'transport-failed'

export class MessagingError extends Error {
  readonly code: MessagingErrorCode

  constructor(code: MessagingErrorCode, message: string) {
    super(message)
    this.name = new.target.name
    this.code = code
  }
}

/** The `oblivion1…` string (or public key) a contact handed over is unusable. */
export class InvalidIdentityError extends MessagingError {
  constructor(message: string) {
    super('invalid-identity', message)
  }
}

/** A message arrived that does not parse, or whose signature does not check out. */
export class InvalidEnvelopeError extends MessagingError {
  constructor(message: string) {
    super('invalid-envelope', message)
  }
}

/**
 * A payment request or receipt that does not hold up: a bad amount, address or
 * id, or a chain this app refuses. The message is not shown as payable.
 */
export class PaymentError extends MessagingError {
  constructor(message: string) {
    super('invalid-payment', message)
  }
}

/** A valid message for a different conversation than the one being read. */
export class WrongConversationError extends MessagingError {
  constructor(message: string) {
    super('wrong-conversation', message)
  }
}

/** A message arrived from a key this session does not know. */
export class UnknownSenderError extends MessagingError {
  constructor(message: string) {
    super('unknown-sender', message)
  }
}

/** Sending to a contact this session is not listening to. */
export class NotWatchingError extends MessagingError {
  constructor(message = 'watch this contact before sending to them') {
    super('not-watching', message)
  }
}
