# Demo script: two browsers chatting and paying on Sepolia

This is the shot list for the milestone-8 recording (PRD §5 milestone 8, §7). It needs a human, a funded testnet wallet and about ten minutes. Nothing here is a substitute for the tests — it is the evidence CI cannot take: two independent browsers, the real Waku network, and a real Sepolia transaction.

## Before you record

- `npm ci` on Node 24.
- **Two origins matter.** The app stores one vault per origin in IndexedDB, so use `http://127.0.0.1:5173` for Alice and `http://localhost:5173` for Bob. Two tabs on the _same_ origin share the vault record and only one of the two will win.
- `npm run dev` in one terminal.
- **Fund the payer only.** Bob needs Sepolia ETH (a public faucet; ~0.01 ETH is plenty). Alice needs none to ask for money — she needs an address, which the vault derives.
- Pick a throwaway password for both vaults and **do not** reveal the recovery phrase on camera. If a phrase appears on screen, cut the recording and start over with a fresh vault.
- Optional: `VITE_SEPOLIA_RPC_URL` to a provider you trust, if the public default is slow on the day. `npm run report` first, so the README numbers in the description come from this build.

## Shot 1 — two vaults, two identities (~2 min)

1. Alice (127.0.0.1): create a vault, write the phrase down off-camera, confirm the three words, land on the dashboard. Show the wallet address and the messaging identity on the identity card, and say out loud that they are different keys.
2. Bob (localhost): the same, and a different address, identity and fingerprint.
3. Alice: Messages → Connect to Waku → note the connection state. Bob: the same.
4. Copy Alice's identity string into Bob's Contacts form (or scan the QR), and Bob's into Alice's. Point out that a wallet address pasted into that field is refused — show it once.

## Shot 2 — sealed chat both ways (~1 min)

5. Alice sends a sentence; it appears in Bob's thread, and Bob replies. Point out that the payload on the wire is `om1.…` — the relay never sees the text.
6. Optional but strong: show that the same vault record on disk (DevTools → Application → IndexedDB → `oblivion-vault`) contains only the KDF parameters, the salt and the `oc1.…` envelope.

## Shot 3 — pay-in-chat (~3 min)

7. Alice: in Bob's thread, request 0.001 ETH with a note ("demo" or nothing). It appears as a card in both threads.
8. Bob: open the card — read the payee address aloud, show the fee line (gas, cap, worst case, total required) **before** clicking, then Pay.
9. Both sides: the hash appears; open it in the explorer. Show the transaction on `sepolia.etherscan.io`, then show the status flip in Bob's wallet and in the thread.
10. Bob: do one decline as well (a second, small request) so the no-chain-call path is on record — the card goes to "Declined." and nothing was broadcast.

## Shot 4 — the refusals (~1 min)

11. Paste a wallet address into the Contacts identity field: refused. Paste your own identity: refused (`self-contact`).
12. Open a send to mainnet — not possible from the UI, which is the point: read the identity card's line that names chain ID 11155111 and says mainnet is a non-goal.
13. Lock the vault (`Lock now`): the wallet, the thread and the signing key disappear; unlock again and they come back from the same vault.

## After the recording

- Paste the recording (or a GIF) above the fold in `README.md`, and add it next to the demo line in `docs/PLAN.md`.
- Record the facts in the milestone-8 log: the two identities' fingerprints, the conversation id, the request id, the transaction hash and its explorer URL, the block, and the wall-clock time from "Pay" to "hash in the thread".
- Report anything that failed or looked wrong. A demo that hit a rough edge is more useful than a demo that hid one — this repo's rule is that negative results are written down, not deleted.
