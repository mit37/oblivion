# Demo script: two browsers chatting and paying on Sepolia

This is the shot list for the milestone-8 recording (PRD §5 milestone 8, §7). It exists twice:

- as a script — [`scripts/demo.mjs`](../scripts/demo.mjs), run by `npm run demo` — which walks
  the list below without a human, writes one Playwright video per browser into
  [`docs/demo`](demo/README.md), and puts the run's own numbers in `docs/demo/facts.json`;
- as the list below, which is what a person does when a funded key is available and the point is
  to show a real transaction end to end.

Nothing here is a substitute for the tests — it is the evidence CI cannot take: two independent
browsers, the real Waku network, and a real Sepolia transaction.

## The recording that exists

`docs/demo/alice.webm` and `docs/demo/bob.webm` are the scripted run: two origins
(`127.0.0.1:4183` and `127.0.0.1:4184`), two vaults, both tabs on the public Waku network,
sealed messages in both directions, the contact refusals, the raw IndexedDB record read back and
searched for plaintext on camera, a payment request walked down to the fee line, a **decline**,
and the lock/unlock cycle. Its identities, fingerprints, topic, refusal messages, the at-rest
search and the timings are in `docs/demo/facts.json`.

Two things that recording does **not** contain, on purpose:

- **A funded payment.** No funded key exists in this repo or in the build environment, so with
  the live endpoint `eth_estimateGas` answers `EVM error: OutOfFunds`, the card shows that, and
  `Pay` stays disabled. The recording shows the decline path instead of pretending.
- **A real transaction hash.** The paying click is recorded against a **stubbed** Sepolia
  endpoint in `docs/demo/stub/` (`--chain=stub`, the same canned JSON-RPC responder
  `e2e/wallet.spec.ts` uses), where the badge on every frame reads `chain: STUB (Sepolia faked)`.
  Real signing, real sealing, real Waku round trip; a fake chain.

To record the funded version, use the two-step flow in
[`docs/demo/README.md`](demo/README.md#what-the-recording-does-and-does-not-show):
`npm run demo:prepare`, fund the printed payer address, then `npm run demo:keep`.

## Before you record

- `npm ci` on Node 24.
- **Two origins matter.** The app stores one vault per origin in IndexedDB, so use
  `http://127.0.0.1:5173` for Alice and `http://localhost:5173` for Bob, or two ports on one host
  (`127.0.0.1:5183` / `:5184`) — the script uses ports, which needs no name resolution. Two tabs
  on the _same_ origin share the vault record and only one of the two will win.
- `npm run dev` in one terminal, or the script's own `npm run demo`, which builds the app and
  serves the built copy on two ports.
- **Create both vaults before you start recording.** The create flow shows the recovery phrase,
  and the phrase must not be on camera; the script keeps its two vaults in a throwaway profile
  under `node_modules/.cache/oblivion-demo`, creates them first, and starts recording at the
  unlock screen.
- **Fund the payer only.** Bob needs Sepolia ETH (a public faucet; ~0.01 ETH is plenty). Alice
  needs none to ask for money — she needs an address, which the vault derives.
- Pick a throwaway password for both vaults and **do not** reveal the recovery phrase on camera.
  If a phrase appears on screen, cut the recording and start over with a fresh vault.
- Optional: `VITE_SEPOLIA_RPC_URL` to a provider you trust, if the public default is slow on the
  day. `npm run report` first, so the README numbers in the description come from this build.

## Shot 1 — two vaults, two identities (~2 min)

1. Alice: unlock the vault (the script's setup phase created it without the camera running).
   Land on the dashboard. Show the wallet address and the messaging identity on the identity
   card, and say out loud that they are different keys.
2. Bob: the same, and a different address, identity and fingerprint.
3. Alice: Messages → Connect to Waku → note the connection state. Bob: the same.
4. Copy Alice's identity string into Bob's Contacts form (or scan the QR), and Bob's into Alice's.
   Point out that a wallet address pasted into that field is refused — show it once.

## Shot 2 — sealed chat both ways (~1 min)

5. Alice sends a sentence; it appears in Bob's thread, and Bob replies. Point out that the payload
   on the wire is `om1.…` — the relay never sees the text.
6. Show that the same vault record on disk (DevTools → Application → IndexedDB →
   `oblivion-vault`) contains only the KDF parameters, the salt and the `oc1.…` envelope. The
   script does this by reading the record out of IndexedDB and rendering it in a panel that says
   it is the recorder's, with a search for the password, the address, the identity string and the
   message text beside it.

## Shot 3 — pay-in-chat (~3 min)

7. Alice: in Bob's thread, request 0.001 ETH with a note ("demo" or nothing). It appears as a card
   in both threads.
8. Bob: open the card — read the payee address aloud, show the fee line (gas, cap, worst case,
   total required) **before** clicking, then Pay. With an unfunded wallet, `Pay` stays disabled
   and the card carries the chain's own refusal instead; say that out loud rather than skipping
   the shot.
9. Both sides: the hash appears; open it in the explorer. Show the transaction on
   `sepolia.etherscan.io`, then show the status flip in Bob's wallet and in the thread.
10. Bob: do one decline as well (a second, small request) so the no-chain-call path is on record —
    the card goes to "Declined." and nothing was broadcast.

## Shot 4 — the refusals (~1 min)

11. Paste a wallet address into the Contacts identity field: refused. Paste your own identity:
    refused (`self-contact`).
12. Open a send to mainnet — not possible from the UI, which is the point: read the identity
    card's line that names chain ID 11155111 and says mainnet is a non-goal.
13. Lock the vault (`Lock now`): the wallet, the thread and the signing key disappear; unlock again
    and they come back from the same vault.

## After the recording

- Paste the recording (or a GIF) above the fold in `README.md`, and add it next to the demo line
  in `docs/PLAN.md`. The scripted run's README asset is `docs/demo/poster.png` linking to
  `docs/demo/alice.webm`, with both screens and the facts file named beside it.
- Record the facts in the milestone-8 log: the two identities' fingerprints, the conversation id,
  the request id, the transaction hash and its explorer URL, the block, and the wall-clock time
  from "Pay" to "hash in the thread". `docs/demo/facts.json` is the machine's copy of exactly
  that; the log is the human's.
- Report anything that failed or looked wrong. A demo that hit a rough edge is more useful than a
  demo that hid one — this repo's rule is that negative results are written down, not deleted.
