/**
 * The wallet's own failures are `WalletError` subclasses: one short sentence and
 * a code. Everything else that reaches the UI is whatever the endpoint threw,
 * and viem wraps a failed JSON-RPC call in a multi-line dump — a headline, the
 * endpoint URL, the request body, the parsed arguments and a version banner.
 *
 * That dump is accurate and unpresentable inside a payment card, so it is
 * classified here into one sentence the reader can act on. This is presentation,
 * not policy: it never changes *whether* something failed, only how it reads.
 * The provider's exact words are still in `docs/demo/facts.json` for the runs
 * this repo recorded, and in the browser console viem wrote them to anyway.
 */
export const MAX_CHAIN_ERROR_LENGTH = 160

/** The account cannot cover the amount plus the fee. */
const OUT_OF_FUNDS =
  /out of funds|outoffunds|insufficient funds|exceeds the balance|insufficient balance/i

/** The endpoint never answered: DNS, TCP, TLS or a fetch rejection. */
const ENDPOINT_UNREACHABLE =
  /fetch failed|failed to fetch|econnrefused|econnreset|econnaborted|enotfound|etimedout|timed? ?out|socket hang up|network error|network request failed|getaddrinfo/i

/** The endpoint answered with a rate limit rather than a result. */
const RATE_LIMITED = /\b429\b|rate.?limit|too many requests/i

/**
 * One sentence for a chain failure, and never more than one line.
 *
 * A known failure gets a sentence that says what to do about it; anything
 * unrecognised keeps the provider's headline and, when the dump names one, the
 * `Details:` line that carries the actual reason (`EVM error: Revert`), because
 * dropping that would make the message less useful than the dump it replaces.
 * The result is capped, so a chatty endpoint cannot fill the card.
 */
export function condenseChainError(cause: unknown): string {
  const raw = readMessage(cause)

  if (raw === null) return 'the Sepolia endpoint did not answer'

  if (OUT_OF_FUNDS.test(raw)) {
    return 'This wallet does not hold enough Sepolia ETH to cover the amount plus the fee. Send testnet ETH to the address above and try again.'
  }

  if (RATE_LIMITED.test(raw)) {
    return 'The Sepolia endpoint is rate-limiting this app. Wait a moment and try again.'
  }

  if (ENDPOINT_UNREACHABLE.test(raw)) {
    return 'The Sepolia endpoint could not be reached. Check this machine’s connection and try again.'
  }

  const headline = firstMeaningfulLine(raw)
  const detail = detailLine(raw)

  if (detail !== null && !headline.toLowerCase().includes(detail.toLowerCase())) {
    return cap(`${headline} (${detail})`)
  }

  return cap(headline)
}

function readMessage(cause: unknown): string | null {
  const text =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined

  return text !== undefined && text.trim().length > 0 ? text : null
}

function firstMeaningfulLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\s+/g, ' ').trim()
    if (trimmed.length > 0) return trimmed
  }

  return 'the Sepolia endpoint did not answer'
}

/** viem ends its dump with `Details: <reason>`; that line is the useful one. */
function detailLine(text: string): string | null {
  const match = /^\s*details:\s*(.+)$/im.exec(text)
  return match === null ? null : match[1].replace(/\s+/g, ' ').trim()
}

function cap(text: string): string {
  if (text.length <= MAX_CHAIN_ERROR_LENGTH) return text

  return `${text.slice(0, MAX_CHAIN_ERROR_LENGTH - 1).trimEnd()}…`
}
