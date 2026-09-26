/**
 * Single source of truth for the safety language required by PRD §2.
 *
 * The smoke tests assert these phrases, so the "prototype, unaudited,
 * testnet only" wording cannot be dropped or softened silently.
 */
export const SAFETY_LABEL = 'Prototype · unaudited · testnet only'

export const SAFETY_WARNING = 'Do not use with real funds or sensitive conversations.'

export const SAFETY_CHAIN_NOTE =
  'Ethereum Sepolia only (chain ID 11155111). Mainnet is a non-goal of this prototype.'
