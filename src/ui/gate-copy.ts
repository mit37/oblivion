import type { VaultError } from '../vault'

/** Which words the confirm step asks for (zero-based), always the same three. */
export const CONFIRM_WORD_INDICES = [2, 5, 9] as const

/**
 * Turns a thrown vault error into something a person can act on. Deliberately
 * vague about *why* an unlock failed: wrong password and damaged record look the
 * same, which is the point.
 */
export function describeVaultError(cause: unknown): string {
  const code = (cause as Partial<VaultError> | null)?.code

  switch (code) {
    case 'weak-password':
      return (cause as Error).message
    case 'wrong-password':
      return 'That password did not open the vault.'
    case 'vault-not-found':
      return 'There is no vault on this device yet.'
    case 'unusable-record':
      return 'This vault record asks for weaker parameters than this build accepts, so it was not opened.'
    default:
      return 'Something went wrong. Nothing was changed.'
  }
}
