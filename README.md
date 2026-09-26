# Oblivion

> **v2 (2026 rebuild).** The original prototype's code was not preserved; this is a clean re-implementation of the same design. Numbers in this README come from this codebase.

A privacy-first messenger and wallet prototype: Waku end-to-end encrypted messaging, an Ethereum testnet wallet, and one encrypted local vault.

> [!WARNING]
> **Prototype, unaudited, testnet only (Ethereum Sepolia).**
> Do not use with real funds or sensitive conversations. Mainnet is a non-goal of this prototype.

[![CI](https://github.com/mit37/oblivion/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mit37/oblivion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> _Demo video: not recorded yet — milestone 8 records two browsers chatting and paying on Sepolia (shot list: [`docs/DEMO.md`](docs/DEMO.md))._

> **Build status — milestone 7 of 8 is complete.** The crypto core, the encrypted vault, the Sepolia wallet, encrypted messaging and pay-in-chat are built and tested, and the threat model is written down ([`docs/SECURITY.md`](docs/SECURITY.md)). It is a working app: create a vault, write down the recovery phrase, confirm three words, unlock, auto-lock, change the password, reveal the phrase or delete the vault — receive testnet ETH at a QR, send it with the fee shown before signing, scan recent activity, watch an ERC-20 — exchange an identity string, add a contact, trade sealed direct messages over the real Waku network, and **ask for testnet ETH inside the thread, pay it in one click and post the transaction hash back into the same conversation**. Two browsers on different origins, each with its own vault and its own key, computed the same conversation id unaided and exchanged messages both ways. Milestone 8 is the recorded demo and the `v2.0.0` tag. Progress and evidence live in [`docs/PLAN.md`](docs/PLAN.md).

## The thirty-second version

Your messages and your money usually live in two apps owned by two companies, and both know too much. Oblivion puts both behind **one password-derived encrypted vault on your device**: peer-to-peer encrypted chat over the Waku network (no central server storing messages) and an Ethereum wallet, **locked to the Sepolia testnet**.

The interesting part is what the app refuses to do. Argon2id (64 MiB, 3 passes) turns your password into a vault key; XChaCha20-Poly1305 seals one versioned document that holds the mnemonic, contacts, history and payment records. A single mnemonic derives two _unrelated_ identities — the wallet at `m/44'/60'/0'/0/0` and the chat key at `m/44'/60'/1'/0/0` — so a contact who knows your chat public key cannot find your wallet address. A record that asks for weaker KDF parameters than this build accepts is refused rather than opened, and the wallet refuses any endpoint that is not Sepolia, mainnet included, before it sends a single request.

The wallet is real: a viem client talks to a public Sepolia endpoint (no API key), your address and its EIP-681 payment QR come from the vault's own key, fees are estimated and shown before you sign, and the signing key exists only while the vault is unlocked.

The chat is real too, which means the network is real: the app runs a Waku light node (LightPush to send, Filter to receive), and every message is sealed with a **fresh key pair per message** and signed over its own header — so the transport, a relay or a peer that happens to be listening only ever sees opaque bytes on a topic it cannot tie to a wallet address. Neither side has to be told the conversation id: it is a hash of both public keys, sorted, so two strangers reach the same topic independently. And nothing in either browser holds the other side's plaintext: messages live only in the encrypted vault, at rest, on the machine that read them.

Pay-in-chat is the same envelope doing a second job: one side seals a Sepolia payment request into the thread, the other sees the amount, the payee and the worst-case fee before it commits, pays with one click from its own wallet, and the transaction hash comes back as a receipt in the same conversation. A request that names mainnet is refused before it is ever published, and a hash that arrives is shown as the payer's claim — with the explorer link right next to it.

## What's in it

| Capability                                                                                          | Status         |
| --------------------------------------------------------------------------------------------------- | -------------- |
| App shell, CI, static GitHub Pages deploy                                                           | ✅ milestone 1 |
| Crypto core: Argon2id KDF, XChaCha20-Poly1305 AEAD, BIP-39/44 derivation, signatures                | ✅ milestone 2 |
| Encrypted vault: create / unlock / lock / re-wrap, IndexedDB, auto-lock, backup + confirm flow      | ✅ milestone 3 |
| Sepolia wallet: balance, receive (QR), send, history, ERC-20 view, mainnet refusal                  | ✅ milestone 4 |
| Waku 1:1 end-to-end encrypted messaging: identity exchange, contacts, sealed chat, history          | ✅ milestone 5 |
| Pay-in-chat payment requests: sealed request in the thread, one-click Sepolia pay, hash posted back | ✅ milestone 6 |     | Security write-up: `docs/SECURITY.md` threat model, known gaps, dependency findings | ✅ milestone 7 |
| Demo recording + `v2.0.0` tag                                                                       | ⏳ milestone 8 |

## Results

<!-- report:start -->

Every number below was produced by this repo on 2026-09-26 with `npm run report` (Node 24.20.0, Windows). A measurement this machine cannot take is reported as **not measured** with the reason, never guessed. The raw output the script parsed is committed as [`docs/report.json`](docs/report.json), and `npm run report:check` fails if this block stops matching it.

| Measurement                                              | Value                                                                    | Command                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| Unit tests (Vitest)                                      | 597 passing, 31 files (2 more skipped), 37.5 s wall time                 | `npm test`                                         |
| - crypto module                                          | 175 tests                                                                | `npx vitest run src/crypto`                        |
| - vault module                                           | 140 tests                                                                | `npx vitest run src/vault`                         |
| - wallet engine                                          | 88 tests                                                                 | `npx vitest run src/wallet`                        |
| - messaging module                                       | 98 tests (2 skipped unless opted in)                                     | `npx vitest run src/messaging`                     |
| - security policy                                        | 8 tests                                                                  | `npx vitest run src/security`                      |
| - app + UI (wallet, QR, chat and pay-in-chat panels)     | 88 tests                                                                 | `npx vitest run src/App.test.tsx src/ui`           |
| End-to-end (Playwright, Chromium, built app)             | 3 passing (5.3 s)                                                        | `npm run test:e2e`                                 |
| Live Waku: a light node carries one transport frame      | not measured here — opt-in: needs outbound network access                | `WAKU_LIVE=1 npm run report`                       |
| Live Waku: two light nodes trade a sealed direct message | not measured here — opt-in: needs outbound network access                | `(same command)`                                   |
| Production bundle, app chunk                             | 702.05 kB (222.21 kB gzip)                                               | `npm run build`                                    |
| Production bundle, CSS                                   | 6.27 kB (1.97 kB gzip)                                                   | `npm run build`                                    |
| Production bundle, lazily loaded libsodium chunk         | 533.91 kB (189.07 kB gzip)                                               | `npm run build`                                    |
| Production bundle, lazily loaded Waku SDK chunk          | 849.47 kB (258.19 kB gzip)                                               | `npm run build`                                    |
| Production bundle, Waku adapter chunk                    | 2.58 kB (1.06 kB gzip)                                                   | `npm run build`                                    |
| Argon2id at the default `interactive` profile            | 0.23 s per derivation                                                    | `npm run report`                                   |
| Dependency advisories (`npm audit`)                      | 6 (2 moderate, 4 high) — reported in CI, non-blocking                    | `npm audit`                                        |
| Pay-in-chat loop in the UI (ask → one click → hash back) | 1.2 s per run (in-memory network + fake chain)                           | `npx vitest run src/ui/messaging-context.test.tsx` |
| Fee shown for a 0.001 ETH send at a 20 gwei gas price    | 0.00084 ETH (worst case, 21 000 gas × a 40 gwei cap)                     | `npx playwright test e2e/wallet.spec.ts`           |
| Real Sepolia RPC response times                          | not measured — needs a funded endpoint on the day; it varies by provider | `npm run report`                                   |
| On-device mobile numbers                                 | not measured — there is no mobile build                                  | `npm run report`                                   |

<!-- report:end -->

The live Waku rows are measured only when the run opts in (`WAKU_LIVE=1 npm run report`); otherwise they say so, with the reason in the row — they are real timings against the public network from one machine, and Waku's own peer discovery dominates them, so they differ anywhere else. The wallet's fee figure is deliberately a _stubbed_ endpoint's response, so it is reproducible in CI without outbound access. CI never reaches the network and never loads the Waku SDK at all.

The script never invents a number: a measurement this machine cannot take becomes a **not measured** row that says why, and the raw output it parsed is committed as [`docs/report.json`](docs/report.json) so a reader can check the working. `npm run report:check` runs in CI and fails if the table drifts from that record.

**Negative result, reported rather than buried:** `@waku/sdk@0.0.36` is the one dependency with known advisories (the counts are the `npm audit` row above) — `@waku/discovery` pulls in `libp2p` packages and `uuid < 11.1.1`. `npm audit` reports them in CI, where the step is non-blocking, and `npm audit fix --force` "resolves" them only by downgrading to `@waku/sdk@0.0.16`, a breaking downgrade of the one dependency the chat runs on. That trade is Mitansh's to make, not the build script's, so the finding stays visible instead of being silenced.

Deliberately weak profile: the `test` KDF profile (8 MiB, 1 pass) exists only so the suite stays fast. It cannot be selected without an explicit opt-in flag that the app never sets, and a stored record requesting those parameters is refused.

## Architecture

```
UI (React 19 + TypeScript + Vite)
 ├─ VaultProvider      unlock state, auto-lock timer, activity listeners
 ├─ VaultGate          create / unlock, mnemonic backup + confirm-words steps
 ├─ Dashboard          identity, build status, auto-lock, password re-wrap, reveal, delete
 ├─ WalletProvider     builds the wallet service from the unlocked vault; tags results
 │                     with the service that produced them, so a locked vault shows nothing stale
 ├─ WalletPanel        balance, receive QR, fee review + send, history scan, ERC-20 list
 ├─ MessagingProvider  chats out over a transport (local or Waku); writes every arrival into the vault
 ├─ MessagingPanel     chat identity + QR, contacts, the thread (text + payment cards), the composer
 └─ useVault() / useWallet() / useMessaging()   three contexts, all derived from the unlocked document

src/messaging/         the chat, and only the chat; storage is somebody else's job
 ├─ identity.ts   conversation ids (hash of both keys, sorted), content topics, contact parsing
 ├─ envelope.ts   per-message ephemeral ECDH → HKDF-SHA256 → XChaCha20-Poly1305, signed header
 ├─ payments.ts   the payment-request / payment-receipt body codec: ids, amounts, chain, refusal to guess
 ├─ service.ts    what we watch, what leaves (sealed + signed), what arrives (opened + verified)
 ├─ transport.ts  the seam: `start` / `stop` / `publish` / `subscribe`, nothing Waku-specific
 ├─ waku.ts       a Waku light node (LightPush + Filter) behind that seam, SDK imported lazily
 └─ in-memory-transport.ts / local-network.ts   the test double, and the demo's per-tab network

src/wallet/            Sepolia only, and it says so in code
 ├─ chain.ts      hard-coded chain ID, MainnetRefusedError, http(s)-only RPC resolver
 ├─ clients.ts    viem public/wallet clients behind ChainReader / ChainSender seams
 ├─ service.ts    balance, fee estimate, send, block-scan history, receipts, ERC-20
 ├─ format.ts     EIP-681 URIs, ETH/token parsing, address validation
 └─ fake-chain.ts in-memory chain double (tests and mock mode; no test touches the network)

src/crypto/            pure functions, no React, no storage
 ├─ kdf.ts        Argon2id (libsodium crypto_pwhash) + documented profiles
 ├─ aead.ts       XChaCha20-Poly1305 seal/open + versioned envelope
 ├─ keys.ts       BIP-39 mnemonic → wallet (BIP-44) and messaging identities
 ├─ signatures.ts SHA-256 + secp256k1 compact signatures
 └─ vectors.ts    published BIP-39/BIP-32/BIP-44 vectors + labelled regression pins

src/security/
 └─ csp.ts          the Content-Security-Policy the built app ships, directive by directive

src/vault/
 ├─ schema.ts       versioned document, migration, defaults, validation
 ├─ vault.ts        create/unlock/lock/update/re-wrap on top of src/crypto
 ├─ storage-idb.ts  IndexedDB record (the only thing ever persisted)
 └─ auto-lock.ts    inactivity lock with an injectable clock

scripts/
 └─ report.mjs      measures the suite, the bundle, the browser tests and the KDF;
                    writes docs/report.json and the README Results table
```

Data at rest is exactly one IndexedDB record: `{ id, version, kdf: { algorithm, opsLimit, memLimitBytes, saltHex }, envelope, createdAt, updatedAt }`. `envelope` is `oc1.<nonce>.<aad|->.<ciphertext>` in unpadded URL-safe base64. `src/vault/no-plaintext.test.ts` scans the real database and fails if the password, the mnemonic, a derived key or an address ever appears outside the sealed envelope — and, since milestone 5, if a contact label, an identity string, a conversation id, a content topic or a message body does either.

On the wire, each message is `om1.<base64url JSON>` in which that JSON is the header `{ version, conversationId, senderPublicKey, ephemeralPublicKey, kind, sentAt, sealed, signature }`: the body is sealed to a **freshly generated** key pair derived for that one message and the header is signed with the sender's identity key. A recipient can therefore prove _who_ sent a frame and _that it is unaltered_, and neither a relay nor a later reader of the network's traffic can read a byte of it or tie the topic back to a wallet address. `kind` is part of the signed header, so a text frame cannot be re-labelled as a payment (or a request as a receipt) on the way — the signature and the associated data both cover it. A `payment-request` body is JSON `{ requestId, payTo, amountWei, note, payToChainId }` and a `payment-receipt` body is `{ requestId, status, txHash, settledAt }`; `kind: "text"` stays free text, and a payment-shaped JSON body sent as text is just text.

### Implementation notes

The decisions that did not need a headline, kept here because each one had a reason:

- **The wallet talks through two narrow interfaces.** `ChainReader` and `ChainSender` are all `WalletService` knows, so every test drives `FakeChain` in memory and the browser test stubs JSON-RPC — no test ever needs the network. Trade-off: `clients.ts` carries an explicit mapping layer where viem's types stop and ours begin.
- **Loaded state is tagged with the service that read it.** A slow reply belonging to a locked vault, or to a previous account, is ignored at render time rather than guarded by a mutable counter. The providers also derive their services from stable primitives (mnemonic, address index, address), because deriving them from the whole vault document meant that storing a message rebuilt the service and its subscriptions — a bug found and fixed while wiring the chat. Trade-off: two overlapping reads for the same service resolve last-write-wins.
- **No indexer.** History is a bounded block scan over the public RPC: no third-party API, no key, no account with a data provider. Trade-off: only recent activity shows — the lookback is a constant, not a full history.
- **QR codes are drawn as SVG by this repo.** `qrcode` produces the matrix and `src/ui/qr.ts` renders it (quiet zone, merged dark runs) instead of pulling in canvas or a second image pipeline. Trade-off: ~60 lines of geometry to keep tested.
- **The caller decides where a message is stored.** `MessagingService` owns what it watches, what leaves and what arrives — not storage — so plaintext has exactly one home: the vault. Trade-off: the UI writes arrivals back itself, which is also why it can deduplicate them.
- **The Waku SDK never loads unless you ask for it.** It is a lazy `import()` behind the Waku transport only, so tests, CI and anyone who stays in local mode never download its chunk (its size is in the table above). Trade-off: the first switch to Waku costs a chunk download before the first peer is found, and `waku.ts` has to carry the SDK's quirks (peer matching by protocol name, and encoders that must come from the node rather than the module).
- **The topic shape follows the wire, not the spec.** The PRD's `/oblivion/1/dm/<id>/proto` is rejected by Waku's own validator, so the conversation id _is_ the name field (`/oblivion/1/<id>/proto`). Same one-topic-per-pair property. Trade-off: a documented deviation from the PRD, called out in the README, in `identity.ts` and in `docs/PLAN.md`.
- **Pay-in-chat reuses the envelope instead of adding a protocol.** A request is a sealed chat message of kind `payment-request` and a receipt is its mirror; the vault's `payments` ledger is the app's view of the same bytes. Trade-off: payments are exactly as available as the chat — if the transport is down, so is the request.
- **The chain a request names is checked, not assumed.** A body must carry `payToChainId`, and the service runs it through the wallet's own guard: mainnet throws and nothing is published, and a body naming no chain is refused rather than assumed. Trade-off: a chain-agnostic future client would be refused outright.
- **The pay button is armed by the fee, not by hope.** The card fetches the estimate first and shows gas, cap, worst case and the total required before Pay is enabled, with the balance checked against amount plus fee. Trade-off: one extra RPC read per request, and Pay stays disabled if the endpoint is unreachable.
- **All randomness from one place.** WebCrypto's `crypto.getRandomValues` produces salts, AEAD nonces and ephemeral keys; libsodium is used only for the KDF and the AEAD, so there is one entropy story to review. Trade-off: one more abstraction between the call sites and the primitive.
- **The Content-Security-Policy is injected into the build only.** `src/security/csp.ts` holds the policy, `vite.config.ts` adds it to `index.html` with a build-time-only plugin, and `src/security/csp.test.ts` pins every directive — including the ones deliberately absent. The dev server gets none, because its inline client and React Fast Refresh would force `'unsafe-inline'` into a policy that then ships weaker. Trade-off: a divergence between dev and the built app, which is why the browser test asserts the policy is in the HTML the build produced.
- **Reload always starts locked.** The vault key is never persisted, not even session-scoped. Trade-off: unlock costs an Argon2id derivation (~0.4 s) every time the tab is refreshed.

## Running it

```bash
npm ci
npm run dev        # app shell on http://localhost:5173
npm run verify     # lint, format check, typecheck, unit tests, build, E2E
```

`npm run report` regenerates the README's Results table from measurements taken on your machine (add `WAKU_LIVE=1` to include the live Waku rows, or stay offline and the table says so). No API keys and no configuration are needed. The first screen asks you to create a vault; the password you choose is the only way back in, and the recovery phrase is shown once (and can be revealed again later from the dashboard).

The Messages panel starts in **local only** mode, where a chat never leaves the tab — useful for trying the UI without a network. "Connect to Waku" swaps in the real light node; to talk between two browsers, copy each identity string (or scan its QR) into the other one's Contacts form, then send. Nothing needs to be configured: `VITE_SEPOLIA_RPC_URL` and `VITE_WAKU_BOOTSTRAP_PEERS` are optional overrides, not requirements.

## Testing

- Unit tests: `npm test` (Vitest + Testing Library in jsdom). Crypto vectors are committed in `src/crypto/vectors.ts` with provenance for every value: published BIP-39 (Trezor), BIP-32 and BIP-44/Ethereum vectors, plus regression pins labelled with the exact library build and capture date.
- Independent checks: BIP-39 seeds are verified against Node's own PBKDF2-HMAC-SHA512 as well as the published vector, and the wallet address vectors are cross-checked against viem's account derivation.
- End-to-end: `npm run test:e2e` (Playwright, Chromium, against the production build served by `vite preview`). `e2e/wallet.spec.ts` creates a vault in a real browser and then balances, sends, checks a receipt and scans history against a **stubbed** Sepolia JSON-RPC endpoint that answers `eth_fillTransaction`, `eth_sendRawTransaction`, `eth_getReceipt` and `eth_getBlockByNumber` with fixtures. viem, the chain guard, the fee arithmetic and the UI are the real code; only the chain is canned, so CI needs no outbound network and no funded key.
- The live Waku path is a test too, just not an automatic one: `WAKU_LIVE=1 npx vitest run --environment node src/messaging/waku.live.test.ts` starts two real light nodes on the public network and trades a sealed direct message between them. It is skipped unless that flag is set, so CI stays hermetic and never downloads the SDK; the timings it produced are in the table above.
- Chat is also covered without the network: `src/messaging/waku.test.ts` drives the adapter with a fake SDK, and `src/ui/messaging-context.test.tsx` runs two identities against an in-memory network to exercise the contact, thread, rejection and vault-storage paths through the real UI.
- Pay-in-chat is tested at the same three levels: `src/messaging/payments.test.ts` (23 tests) pins the codec — a request must name its chain, a paid receipt must carry a 32-byte hash, a declined one must not; `src/messaging/service.test.ts` proves the amount and the payee address never appear on the wire in the clear and that a mainnet request publishes nothing; `src/ui/messaging-context.test.tsx` drives the whole loop through the UI — ask, pay with one click against the in-memory chain, hash back in the thread, decline without a chain call, and a shortfall that disables the button.
- CI runs lint, format check, typecheck, unit tests, build, Playwright and gitleaks on every push and pull request, and reports `npm audit` without failing the build.
- The threat model is a document, not a test, but it is written from the code: every claim in [`docs/SECURITY.md`](docs/SECURITY.md) names the module and the test file that backs it, and the things that are _not_ defended are listed there as carefully as the things that are. The one part of it that _is_ a test is the Content-Security-Policy: `src/security/csp.test.ts` pins each directive and the deliberately absent ones, and `e2e/smoke.spec.ts` asserts the policy is in the HTML the build produced.
- Every number in the Results table is generated: `npm run report` measures the suite (Vitest's JSON reporter), the bundle (Vite's own build output), the browser tests, one Argon2id derivation and `npm audit`, writes `docs/report.json`, and rewrites the README block from it. `npm run report:check` runs in CI and fails if the table and the record drift apart, and a measurement this machine cannot take is written as **not measured** with its reason rather than guessed.

## What this does not do

- **Not audited, and testnet only.** Mainnet is refused in code (chain ID 1 throws `MainnetRefusedError`) and covered by tests in `src/wallet/chain.test.ts` and `src/ui/wallet-context.test.tsx`, which also prove nothing is fetched after the refusal. Do not use it with real funds.
- **Chat has no history from the network.** Only LightPush and Filter are wired up — there is no Store query — so a message sent while your app was closed is simply gone: there is nothing to fetch it from. History is what your own vault holds, and a vault is one device.
- **A payment request never expires and cannot be refunded.** It stays payable until the recipient pays or declines; there is no expiry, no cancellation after it has been sent and no refund path — a wrong payment on Sepolia is a wrong payment, and only the payer's own transaction can move it. One request is in flight at a time, and there is no fiat amount, no tip and no cart.
- **The thread posts the hash; it does not watch the chain for it.** The payer's wallet signs and broadcasts, the wallet's own receipt read is what confirms the transaction, and the hash lands in both vaults so either side can open it in an explorer. The chat itself makes no claim beyond "the payer said this hash"; a lying payer could post a hash for a transaction that never happened, and the other side would only find out at the explorer link. Amounts, addresses and the ledger live only in the encrypted vaults, so no third party is told what was asked for.
- **The ledger records a request, not a payer.** A request names the payee; the receipt names a transaction. Neither carries the payer's address, so the ledger keeps `from: null` rather than inferring it — quote the transaction hash if you need to prove who paid.
- **A Waku relay sees that you are talking, and how much.** It cannot see the text, who you are, or your wallet address, but it can see a light node asking for traffic on a topic, the topic's size and timing, and your IP. Two contacts who paste each other's identity strings share one topic, so a relay that watches long enough can group those messages as one conversation even without names. There is no Tor or mixnet mode.
- **No forward secrecy.** Each message uses a fresh ephemeral key pair and the sender discards it, but the recipient's long-term key plus the ephemeral public key in the envelope is enough to re-derive a message key — whoever holds your messaging private key can open any frame they kept. There is also no ratchet, no post-compromise healing and no deniability: every message carries a signature that proves who sent it.
- **The content topic deviates from the PRD, deliberately.** The PRD specifies `/oblivion/1/dm/<conv-id>/proto`; Waku's autosharding validator (RFC 51) reads a topic as application/version/name/encoding with an optional generation prefix and rejects the extra segment, so the shipped topic is `/oblivion/1/<conv-id>/proto`. Same one-topic-per-pair property, one fewer field. The reasoning lives in `src/messaging/identity.ts` and `docs/PLAN.md`.
- **A contact is a key you pasted, and nothing more.** There is no directory, no key transparency and no verification beyond reading the four-fingerprint out loud. If you paste an attacker's identity string, you are messaging the attacker — no server can notice for you.
- **Removing a contact is local, and irreversible.** It stops listening and drops the thread from your vault; the other side keeps everything they already received, and can still reach the topic.
- **No indexer, so history is shallow.** Recent activity comes from scanning the last 12 blocks over a public RPC (`DEFAULT_HISTORY_LOOKBACK_BLOCKS`). Older transfers are simply not listed — that is a scan limit, not a balance-of-payments problem. A block explorer covers the rest.
- **The RPC provider sees your address.** Every balance read, history scan and broadcast goes to whatever endpoint is configured (`VITE_SEPOLIA_RPC_URL`, public by default), and that provider sees your IP and your address. Run your own node to avoid it.
- **No ERC-20 transfers, no approvals, no token prices.** The token view reads `name`, `symbol`, `decimals` and `balanceOf`; it never values a token in fiat and cannot move one.
- **One recipient at a time, no batching, no gas-speed choice.** Fees are whatever the endpoint suggests, doubled for headroom; there is no "slow/normal/fast" selector and no transaction replacement.
- **Desktop browser only.** No mobile build, no hardware wallet, no WalletConnect.
- **No recovery.** Lose the password and the phrase and the data is gone; there is no server, no reset link and no support desk.
- **No protection against a compromised device.** Malware, a keylogger, a malicious extension or someone with your unlocked session can read what you can read: the decrypted document is a JavaScript value that cannot be wiped like the vault key is. The full list — including what a relay can measure, why there is no forward secrecy, and what a payment request does _not_ prove — is in [`docs/SECURITY.md`](docs/SECURITY.md).
- **A Content-Security-Policy, but no response headers.** The built app ships a meta policy (`default-src 'self'`; no inline scripts; WebAssembly allowed for libsodium; `connect-src` limited to `https:`/`wss:` because the wallet's endpoint and the Waku peers are chosen at runtime), and the app never uses `dangerouslySetInnerHTML`, `eval`, `localStorage` or cookies. What it cannot do: GitHub Pages sets no response headers, so there is no `frame-ancestors` — clickjacking is not prevented — and no HSTS. Both are named in the threat model.
- **Two third parties still learn something, and neither is hidden.** A Waku relay sees your chat traffic (above), and the RPC provider sees your wallet address (above). Everything that was designed to withstand an observer — the envelope, the ciphertext, the vault record — is worthless to them; the metadata is simply not defended.
- **No telemetry, no analytics, no logging of key material.** `no-console` is an ESLint error in `src/`.
- **Never planned:** mainnet, group chats, swaps/DEX, NFTs, custodial anything, or a mobile-native app (PRD non-goals).

## Design decisions

- **One vault, two identities.** The mnemonic derives the wallet at `m/44'/60'/0'/0/<i>` and the chat key at `m/44'/60'/1'/0/0`. Different BIP-44 branches, so a chat contact cannot link your messages to your wallet address. Trade-off: one backup covers both, so the phrase is worth more to an attacker.
- **Refuse weak parameters instead of trusting the record.** Stored KDF parameters are re-validated on unlock and anything below the `interactive` profile is rejected (`UnusableRecordError`); a wrong password and a damaged vault surface as one error, so the failure mode tells an attacker nothing. Trade-off: a hand-edited record is unopenable and the user cannot tell the two failures apart — both intended.
- **Standards only, no hand-rolled crypto.** Argon2id and XChaCha20-Poly1305 come from `libsodium-wrappers-sumo`; derivation from `@scure/bip39`/`@scure/bip32`; curve operations, signatures and wallet accounts from `@noble/curves` and `viem`. Trade-off: one more lazily loaded WASM chunk to ship (its size is in the table above), and an advisories list you did not write (the `npm audit` row above).
- **Chain is a hard-coded constant, not a setting.** Sepolia's ID lives in `src/wallet/chain.ts` and the guard throws on anything else — mainnet first, with its own error, so the refusal is visible rather than generic. Trade-off: pointing the prototype at a local fork means editing code, on purpose.
- **A fresh key pair for every message.** The body is sealed to an ephemeral secp256k1 key generated for that one message, HKDF-SHA256'd (salt = conversation id, info = `oblivion/1/dm`) and discarded by the sender afterwards; the canonical header is signed and used as associated data, so a forged or re-labelled frame does not open. Trade-off: no forward secrecy against a compromised long-term key, no deniability, and one key generation per message (the limitations above say why).
- **The transport is an interface, not a Waku call.** `start` / `stop` / `publish` / `subscribe` is all the service knows, which is what lets the whole chat run in tests against an in-memory network and lets the app ship a "local only" mode. Trade-off: one adapter file to keep honest about the SDK's behaviour.

## Credits & licenses

MIT — see [LICENSE](LICENSE). Built with AI coding agents (Freebuff/GLM) under my direction; design, specs, review and evaluation are mine.

Repo plan and rules: [`PRD.md`](PRD.md), [`STANDARDS.md`](STANDARDS.md), [`docs/PLAN.md`](docs/PLAN.md). Security: [`docs/SECURITY.md`](docs/SECURITY.md) (threat model and known gaps).
