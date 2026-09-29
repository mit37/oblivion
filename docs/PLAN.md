# Oblivion — build plan

Restated from `PRD.md` (§5 milestones, §7 Definition of Done) and `STANDARDS.md` (§6 build order). If `PRD.md` and `STANDARDS.md` disagree, `STANDARDS.md` wins.

Ground rules carried from the PRD, in force for every milestone:

- Testnet only. The chain ID is hard-coded to Sepolia; the code refuses mainnet and a test enforces that.
- "Prototype, unaudited, testnet only" appears in the app and the README. Do not use with real funds or sensitive conversations.
- Only standard, reviewed crypto libraries. No hand-rolled cryptography.
- No telemetry, no analytics, nothing logged, no key material leaves the vault unencrypted.
- Every README number is produced by a script in this repo (STANDARDS §1.3); anything unmeasurable is reported as "not measured" with the reason. Negative results are reported, never deleted.
- No backdated commits.

---

## Definition of Done (PRD §7)

- [x] Crypto tests incl. BIP-39/44 vectors and tamper detection (≥60 tests) — 175 crypto tests
- [x] Mainnet refusal enforced by a test — `wallet/chain.test.ts` (guard) and `ui/wallet-context.test.tsx` (no chain call happens after the refusal)
- [x] No plaintext at rest (test-scanned) — `vault/no-plaintext.test.ts` scans the real IndexedDB record for the password, the mnemonic, derived keys, addresses **and, since milestone 5, a contact label, an identity string, a conversation id, a topic string and a message body** (`oblivion:dm`/`/oblivion/1` included), with a control that reopens the same record and reads the body back
- [x] Two-party E2EE chat + pay-in-chat demo recorded on testnet — recorded on 2026-09-27 by `scripts/demo.mjs` into [`docs/demo`](demo/README.md): two origins, two vaults, the public Waku network, sealed chat both ways, the contact refusals, the raw IndexedDB record read back and searched for plaintext on camera, a request walked down to the fee line and declined, and the lock/unlock cycle. **One shot is not testnet-real and the repo says so above the fold:** no funded key exists here, so the live run's payer is empty and the paying click is a separately labelled run against a stubbed endpoint (`docs/demo/stub`, badge `chain: STUB (Sepolia faked)`). The funded payment is the one step left for Mitansh — `npm run demo:prepare`, fund, `npm run demo:keep`
- [x] `docs/SECURITY.md` threat model; "unaudited, testnet only" banner in app + README — the banner is in place (`src/safety.ts`, README header, `e2e/smoke.spec.ts` asserts it) and the threat model was written at milestone 7
- [x] Tag `v2.0.0` — annotated on the milestone-8 commit, once the demo, the README and the regenerated numbers were all in it
- [x] CI green on GitHub — pushed on 2026-09-27 to [mit37/oblivion](https://github.com/mit37/oblivion) with the `v2.0.0` tag, and run [36287032091](https://github.com/mit37/oblivion/actions/runs/36287032091) on `14f04f8` is green in both jobs, with the Pages deploy [36287032119](https://github.com/mit37/oblivion/actions/runs/36287032119) beside it. It took three runs, and the two reds are worth keeping: the first went red on the secret scan alone because `gitleaks-action@v2` derives its range as `<parent of the first pushed commit>^..<head>` and on a first push that commit is the root, so git refused the argument and the job failed without scanning; the second scanned for real and found four values that only look like credentials; the third is green after the job moved to the pinned 8.24.3 binary and `.gitleaks.toml` named those four values
- [x] `gitleaks` run locally before the first push — the pinned 8.24.3 binary (downloaded into the ignored `node_modules/.cache`) reports `15 commits scanned`, `scanned ~1003369 bytes`, `no leaks found`, and a control secret piped through `gitleaks stdin` still trips its rule

---

## Milestones (PRD §5)

### 1. Scaffold, CI, static deploy — **complete**

- [x] Vite + React + TypeScript app shell with the mandatory safety banner (`src/safety.ts`)
- [x] ESLint (flat config) + Prettier + `tsc --noEmit`, enforced in CI
- [x] Vitest smoke test (jsdom + Testing Library, RTL cleanup in `src/test/setup.ts`)
- [x] Playwright smoke test against the production build (`vite preview`)
- [x] GitHub Actions `ci.yml`: lint → format check → typecheck → unit tests → build → Playwright → gitleaks, with `npm audit` reported (non-blocking). The secret-scan job installs the pinned gitleaks 8.24.3 release and scans the whole history rather than the range the action derives from the push event, which cannot be resolved on a repository's first push
- [x] GitHub Actions `pages.yml`: static deploy to GitHub Pages with `VITE_BASE=/oblivion/`
- [x] `PRD.md`, `STANDARDS.md`, `AGENTS.md`, `CLAUDE.md` copied into the repo root
- [x] Local verification on Node 24 / Windows: `lint`, `format:check`, `typecheck`, `test` (2 passing), `build` and `test:e2e` (1 passing) all green
- [x] CI green on GitHub (run [36287032091](https://github.com/mit37/oblivion/actions/runs/36287032091); the site is live at https://mit37.github.io/oblivion/)
- [x] `gitleaks` locally before the first push (pinned 8.24.3, 15 commits, no leaks — see the verification log)

### 2. Crypto module — **complete**

- [x] `src/crypto/kdf.ts`: Argon2id via `libsodium-wrappers-sumo` `crypto_pwhash`, with three documented profiles (`test` 8 MiB/1 pass, `interactive` 64 MiB/3 passes, `sensitive` 256 MiB/4 passes). Parameters weaker than `interactive` are refused unless a caller explicitly opts in with `allowTestProfile`, so no shipping code path can pick a fast profile by accident
- [x] `src/crypto/aead.ts`: XChaCha20-Poly1305 seal/open, a versioned envelope (`oc1.<nonce>.<aad|->.<ciphertext>`) with constant-time context checks, and text/JSON helpers
- [x] `src/crypto/keys.ts`: BIP-39 mnemonic → Ethereum account at `m/44'/60'/0'/0/<index>` and a separate messaging keypair at `m/44'/60'/1'/0/0`, plus `oblivion1…` identity strings, validation and fingerprints
- [x] `src/crypto/signatures.ts`: SHA-256 + secp256k1 compact signatures for message authenticity
- [x] `src/crypto/vectors.ts`: published BIP-39 (Trezor), BIP-32 and BIP-44/Ethereum vectors, plus regression pins labelled with the exact library build and capture date. Every entry carries provenance and none is presented as more than it is
- [x] Tamper detection: flipped ciphertext, tag, nonce, associated data and envelope bytes all fail with `DecryptionFailedError`
- [x] 175 crypto tests (requirement: ≥60); 177 tests in the whole suite

### 3. Vault — **complete**

- [x] `src/vault/vault.ts`: create / unlock / lock / update / re-wrap, with one IndexedDB record holding only the Argon2id parameters, the salt and the sealed envelope
- [x] `src/vault/storage-idb.ts`: `idb`-backed storage (plus an in-memory implementation for tests and mock mode)
- [x] `src/vault/schema.ts`: versioned document with a migration that validates and fills defaults, refuses the weak test profile and rejects unknown message kinds
- [x] Auto-lock after inactivity (`src/vault/auto-lock.ts`, injectable clock, activity events) plus manual lock; a reload always starts locked
- [x] Password change re-wraps the document under a fresh salt and key; a test proves the old password stops working
- [x] `src/vault/no-plaintext.test.ts` scans the real IndexedDB contents for the password, the mnemonic, derived keys and addresses, with a control test showing the mnemonic _is_ inside the sealed payload
- [x] Mnemonic backup flow with a confirm-words step, and a dashboard for identity, auto-lock, password change, phrase reveal and deletion
- [x] The UI never offers the test KDF profile: only an injected test vault can request it, and a stored record asking for weaker parameters is refused (`UnusableRecordError`)
- [x] 130 vault tests plus 25 UI/app tests; 330 tests in the whole suite

### 4. Wallet (Sepolia) — **complete**

- [x] `src/wallet/chain.ts`: hard-coded Sepolia chain ID, `MainnetRefusedError` for chain 1 and `UnsupportedChainError` for anything else, plus an http(s)-only RPC resolver (`VITE_SEPOLIA_RPC_URL` → public endpoint, no key needed)
- [x] `src/wallet/clients.ts`: viem public client and wallet client behind a narrow `ChainReader` / `ChainSender` seam, so every test drives an in-memory chain double instead of the network
- [x] `src/wallet/service.ts`: balance, fee estimate (gas, EIP-1559 caps, worst-case fee, total required), send with a balance check that includes the fee, a bounded block-scan history, receipt status, ERC-20 metadata and balances
- [x] `src/wallet/format.ts`: EIP-681 payment URIs (build + parse, other chains refused), ETH/token parsing and formatting, address validation, `shortenAddress`, and the send-form resolver that accepts an address or a payment link
- [x] Balance, receive (QR), send ETH with gas estimate + confirmation screen (`src/ui/WalletPanel.tsx`)
- [x] Transaction history via a configurable public RPC, no API key required by default
- [x] ERC-20 balance view for a token list, stored in the vault and read from the contract before it is saved
- [x] QR rendering with no runtime dependency on canvas: `qrcode` produces the matrix, `src/ui/qr.ts` draws the SVG (quiet zone, merged dark runs, `data-qr-*` for tests)
- [x] Wallet state is derived from the unlocked vault and tagged with the service that produced it, so a slow reply from a locked vault or another account cannot be shown; signing key and service disappear on lock (tested)
- [x] 131 new tests (wallet engine 88, wallet UI 24, QR 19), 467 in the whole suite; plus a browser test that drives the wallet against a stubbed Sepolia JSON-RPC endpoint (`e2e/wallet.spec.ts`)
- [x] Live check against the real public endpoint on the built app: the balance read, the QR, the fee review and the ERC-20 form all rendered correctly in Chromium

### 5. Waku messaging — **complete**

- [x] `@waku/sdk` light node behind a narrow `MessageTransport` seam: LightPush to send, Filter to receive (`src/messaging/waku.ts`). The SDK is imported lazily, so no test and no CI run ever loads it
- [x] Contacts exchanged as an `oblivion1…` identity string (or the raw compressed public key behind it) and rendered as a QR; a wallet address pasted into that field is refused (`InvalidIdentityError`), as is your own identity (`self-contact`)
- [x] 1:1 chats, content topic `/oblivion/1/<conv-id>/proto` — **not** the PRD's `/oblivion/1/dm/<conv-id>/proto`, see the deviation note below — with payloads sealed before they reach the transport
- [x] Per-message ephemeral ECDH: a fresh secp256k1 key per message, HKDF-SHA256 (salt = conversation id, info = `oblivion/1/dm`) into XChaCha20-Poly1305, with the canonical message header as associated data and a compact signature over the header (SHA-256 prehash), so the recipient proves who sent it (`src/messaging/envelope.ts`)
- [x] Conversation ids derived from **both** public keys, sorted and hashed, so either side computes the same id unaided and no third party can predict it from one key
- [x] Message history saved in the vault (schema v2), deduplicated on arrival, rendered per conversation with the direction, time and sender
- [x] A frame that cannot be opened is reported to `onRejected` and surfaced in the panel as an error, never shown as a message; a message for a contact who was removed is counted as an orphan rather than lost
- [x] Sending to someone you have not added is refused (`NotWatchingError`), the sender's own echo is dropped (returns `null`), and an empty or oversized body (>4 000 chars) is refused
- [ ] **Not done: Store protocol (history from the network).** Only LightPush + Filter are wired up, so a message sent while the app was closed is simply gone — there is nothing to backfill from. Recorded here, in the README limitations and for the milestone 7 threat model rather than quietly dropped
- [x] Tests: 64 unit tests across `messaging/envelope` (23, seal/open, tamper, signature and replay cases), `messaging/service` (17, watch/send/receive/reject semantics), `messaging/identity` (13) and `messaging/waku` (11, the adapter driven by a fake SDK); 13 more in `ui/messaging-context` cover the contacts, thread and error paths against an in-memory network
- [x] The one test that needs the real network (`messaging/waku.live.test.ts`) is opt-in behind `WAKU_LIVE=1` and skipped everywhere else, so CI stays hermetic
- [x] Two real browsers on the public Waku network exchanged sealed messages in both directions, verified by hand on the built app (below)

### 6. Pay-in-chat — **complete**

- [x] A payment request is a chat message: `MessagingService.sendPaymentRequest` validates the draft (address, amount, chain) and seals `{requestId, payTo, amountWei, note, payToChainId}` under the signed kind `payment-request`, so a request that could never be paid never reaches the wire
- [x] The recipient pays from the thread with one click, after the fee is fetched and shown **before** the button is armed (gas, cap, worst case, total required) and the balance is checked against amount + worst-case fee; a shortfall disables Pay and says why
- [x] The hash comes back as a `payment-receipt` (`paid`, a 32-byte hash is required by the codec, openable from the thread) or a `declined` receipt — which a test proves makes no chain call at all
- [x] The kind is signed and AAD-bound, so a frame cannot be re-labelled (text as a payment, a request as a receipt); a payment body that does not parse is rejected on receipt and rendered as a failed frame, never as a pay button
- [x] The chain guard rides along: a request naming mainnet fails with `MainnetRefusedError` before anything is published, any other chain with `UnsupportedChainError`, and a request that names no chain at all is refused rather than assumed to be Sepolia
- [x] Vault schema v3: a request carries the requester's address, not the payer's, so `PaymentRecord.from` is nullable; the ledger records role `requested` (my request) or `received` (somebody else's) and a receipt for a request this vault never held updates nothing — it stays a message in the thread
- [x] Tests: 23 codec tests (`messaging/payments.test.ts`), 11 new service tests (28 in that file), 6 new UI tests (19 in `ui/messaging-context.test.tsx`, including request → pay → hash-in-thread, decline, shortfall, and an unreadable payment frame), 4 new vault-schema tests for the nullable payer and the v2 → v3 upgrade; 589 in the whole suite
- [ ] Not done, and named: no refund path, no expiry on a request (a stale request stays payable), the posted hash is **not** confirmed on-chain by the chat itself (the payer's wallet read and the explorer link are the check), no fiat amount, one request at a time, and the note is only as private as the envelope

### 7. Security write-up — **complete**

- [x] `docs/SECURITY.md`: an assets table (where each secret lives and what protects it, including the note that the vault key is zeroed while the decrypted document is a JavaScript value that cannot be), a trust-boundary diagram, and the two flows that leave the device
- [x] What is defended, each claim named with the code that enforces it and the test that pins it: relay opacity via per-message ephemeral keys, theft at rest (Argon2id plus the plaintext scan with its control), parameter-downgrade refusal, the hostile contact (signature, conversation binding, authenticated `kind`), the wallet's mainnet refusal with no request made, and pay-in-chat's request/receipt semantics
- [x] What is **not** defended, as an explicit list rather than an omission: a compromised device or extension, no response-header hardening (Pages cannot set headers; the meta Content-Security-Policy added in milestone 8 covers scripts, connections, styles, embeds, `<base>` and form posts), JavaScript strings that cannot be wiped, no forward secrecy/ratchet/deniability, replay with no freshness bound, unpadded length and timing metadata, bootstrap peers seeing the IP and topics, no Store history, pasted-key contacts with no transparency, `payTo` not bound to the contact, an unverified receipt hash, `from: null` and no reconciliation, no expiry/refund, the RPC provider, 12-block history, the `@waku/sdk` advisories, Actions pinned by mutable tags, `gitleaks` in CI only, and unaudited WASM/JS running in a browser tab
- [x] Crypto choices with their reasons: the Argon2id profiles and why the weak one cannot ship, the `oc1` envelope and its associated data, `oblivion/vault/v1` + salt and `oblivion/1/dm` as domain separation, RFC 6979 deterministic signatures and what signatures give up (deniability), and why no primitive is hand-rolled
- [x] Pay-in-chat analysed on its own terms: a request proves authenticity, not that the payee address belongs to the contact; a receipt is a claim until the explorer confirms it; the local ledger can be partial by design
- [x] The RPC provider is in the threat model as a third party (the note left here at milestone 4), next to the Waku relay
- [x] Reporting paragraph: no security team, no bounty, how to report without pasting secrets, and when this document gets revised (milestone 8, with the regenerated numbers)
- [x] The banner is unchanged and still asserted by `e2e/smoke.spec.ts`, the README header and `src/safety.ts`

### 8. Ship — complete

- [x] `scripts/report.mjs` + `npm run report` / `npm run report:check`: the README Results table is generated, not typed. The script runs the suite with Vitest's JSON reporter (total, per-module and the pay-in-chat test duration), builds and reads the chunk sizes out of Vite's own output, runs Playwright with its JSON reporter, times one Argon2id derivation at the `interactive` profile, and records `npm audit`'s counts. Raw measurements go to `docs/report.json`; the README block between `<!-- report:start -->` and `<!-- report:end -->` is rewritten from it and Prettier-formatted. `npm run report:check` (in CI) fails if the table drifts from the record, and refuses to report a failed or empty measurement as a number
- [x] Not-measured rows instead of guesses: real Sepolia RPC response times and mobile numbers say why, and the live Waku rows are measured only by an opt-in run (`WAKU_LIVE=1 npm run report`, or `-- --only=live` for just those rows) — otherwise they say `opt-in: needs outbound network access`. A live run that fails is written up as a failure with its message, never as a number
- [x] The e2e stub's gas numbers and the README's fee row now come from one fixture (`e2e/stub-chain.json`), so the worked example cannot drift from the assertion it belongs to
- [x] `Design decisions` trimmed to the template's six headline trade-offs, with the long tail (and the bug found while wiring the chat) moved into `### Implementation notes` under the architecture section
- [x] A Content-Security-Policy in the built app: `src/security/csp.ts` holds it (`default-src 'self'`; `script-src 'self' 'wasm-unsafe-eval'` with no inline scripts; `connect-src 'self' https: wss:` for the wallet's endpoint and the Waku peers; `style-src 'self' 'unsafe-inline'` for React's `style` attributes; `object-src`, `base-uri` and `form-action` all `'none'`), a build-only Vite plugin injects the meta tag, eight tests pin every directive _and_ the absent ones (`'unsafe-inline'` in `script-src`, `frame-ancestors`, which a meta policy cannot enforce), and the smoke test asserts the built HTML carries it. The dev server deliberately gets no policy, because its inline client would force a weaker one
- [x] `docs/DEMO.md`: the shot list for the recording — two origins for two vaults, the funding note (only the payer needs Sepolia ETH), four shots (two identities, sealed chat both ways, pay-in-chat including the decline path, and the refusals), and what to record afterwards
- [x] `scripts/demo.mjs` + `npm run demo` / `demo:stub` / `demo:prepare` / `demo:keep`: the recording is a script, not an improvisation. It keeps two vaults in a throwaway profile (created before the camera runs, so no recovery phrase is on camera), unlocks both, connects both to the real Waku network, exercises the refusals, sends sealed messages each way, reads the vault record out of IndexedDB and searches it for plaintext on screen, walks pay-in-chat to the fee line and a decline, and locks and unlocks. Every frame carries a badge naming the tab, the origin and the chain (live or stubbed), plus a caption bar the script writes; the run's own numbers land in `docs/demo/facts.json`
- [x] The recording itself, and the demo asset above the fold in the README (`docs/demo/poster.png` linking to both screens, with the unfunded-payer caveat in the same block)
- [x] Two runs recorded and committed, each with its own facts file: the live one (unfunded payer, request → fee line → decline) and the labelled stub one (fee → Pay → hash back through the sealed thread in 1.4 s)
- [x] `docs/demo/README.md`: what each file is, what is real and what is canned, and the two-step funded flow
- [x] README completed from the STANDARDS §4 template: demo asset above the fold, generated numbers, six headline design decisions, the long tail under `### Implementation notes`
- [x] `gitleaks` run locally before the first push (pinned 8.24.3, whole history, no leaks; the four test-vector false positives it found first are allowlisted by value, not by file, in `.gitleaks.toml`)
- [x] Tag `v2.0.0`

---

## Deviation from the PRD: the content topic

The PRD writes the 1:1 topic as `/oblivion/1/dm/<conv-id>/proto`. That string cannot be sent on Waku. RFC 51 autosharding validation (`ensureValidContentTopic`, called by the SDK) splits a topic on `/` and allows an application, a version, a name and an encoding — four fields — plus an optional generation prefix, and it reads the _second_ field as the generation. `/oblivion/1/dm/<conv-id>/proto` has five, so the SDK throws before a single byte leaves the node.

The shipped topic is therefore `/oblivion/1/<conv-id>/proto`: same prefix, same version, same `/proto` encoding, same one-topic-per-pair property, with the conversation id as the name field instead of a sentinel segment. `src/messaging/identity.ts` carries the explanation next to the constant, `waku.test.ts` asserts the shape (exactly five parts, a 32-hex id in field four), and the deviation is repeated in the README limitations. Nothing else about the PRD's messaging design changed.

---

## Cloud-instance constraints (PRD §6)

- The Waku network and public Sepolia RPC need outbound network access, which the build environment may block. **CI mocks both**, and a documented manual test covers the live path. The two-browser demo on the live testnet is recorded by `scripts/demo.mjs` (`docs/DEMO.md`, milestone 8); the _funded_ transaction inside it is the one part that needs a person with a faucet, and the recorder is built so that person only has to fund an address and press one command.
- Sepolia ETH comes from a public faucet; Mitansh funds the demo wallet himself. The repo never holds a funded key.
- Numbers that cannot be measured in the build environment are reported as "not measured" in the README, with the reason.

## Local verification log

Recorded here as milestones complete, so results are traceable:

- **Milestone 1** (this build): `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` all pass locally on Node 24 / Windows (`npm run verify` is the one-command form).
  - Unit tests: 1 file, 2 tests passing (Vitest 5.0.2, jsdom).
  - End-to-end: 1 test passing (Playwright 1.63, Chromium, against the production build).
  - `npm install`: 237 packages, 0 vulnerabilities reported by `npm audit`.
  - Note for future milestones: `vite preview` binds `::1` on this machine, so the Playwright config pins `--host 127.0.0.1`; without it the readiness probe on `127.0.0.1` times out.
  - CI cannot be observed as green until the repo is pushed to GitHub.
- **Milestone 3**: 330 tests passing across 16 files — `vault/vault` 46, `vault/schema` 37, `vault/auto-lock` 15, `vault/storage` 12, `vault/identity` 10, `vault/no-plaintext` 10, `ui/Dashboard` 10, `ui/VaultGate` 10, `App` 5. Whole suite runs in ~21 s on this machine.
  - Browser walkthrough on the built app (Chromium, `vite preview`): created a vault end to end (real Argon2id in WASM), wrote down the 12-word phrase, confirmed three words, reached the dashboard, reloaded to find the unlock gate (so a reload starts locked), unlocked with the same address, then deleted the vault and confirmed the object store held 0 records.
  - Build output: `index` 400.6 kB (133.8 kB gzip) plus a lazily loaded `libsodium-wrappers` chunk of 533.9 kB (189.1 kB gzip), which is only fetched on the first crypto call.
- **Milestone 2**: 177 tests passing across 8 files — `crypto/keys` 49, `crypto/aead` 39, `crypto/kdf` 31, `crypto/encoding` 20, `crypto/vectors` 17, `crypto/signatures` 13, `crypto/random` 6, `App` 2. Whole suite runs in ~7 s on this machine.
  - Argon2id at the `interactive` profile (64 MiB, 3 passes) measured at ~0.41 s for one derivation on this machine; the `test` profile (8 MiB, 1 pass) keeps the suite fast.
  - BIP-39 seeds are checked twice: against the published Trezor vector and against Node's own PBKDF2-HMAC-SHA512, an independent implementation.
  - Cross-realm note for future milestones: inside jsdom, `TextEncoder` returns another realm's `Uint8Array`, so byte checks use a realm-agnostic tag test (`isUint8Array`) instead of `instanceof`.

- **Milestone 4**: 467 tests passing across 23 files — `wallet/service` 38, `wallet/format` 36, `wallet/chain` 14, `ui/wallet-context` 13, `ui/WalletPanel` 11, `ui/qr` 14, `ui/QrCode` 5, plus 5 new vault-schema tests for the token list and 1 new dashboard test. Whole suite runs in ~28 s on this machine.
  - End-to-end: 2 Playwright tests passing — the shell smoke test and `e2e/wallet.spec.ts`, which creates a vault in a real browser, then balances, sends (21 000 gas × 40 gwei cap = 0.00084 ETH worst case, total 0.00184 ETH), reads a receipt and scans history against a **stubbed** Sepolia endpoint (`eth_fillTransaction`, `eth_sendRawTransaction`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`). viem, the chain guard, the fee maths and the UI are real; only the chain is canned, so CI needs no outbound network.
  - Live check on the built app (Chromium, real public RPC): created a vault, reached the dashboard, and the wallet read a real Sepolia balance of 0 ETH through `https://ethereum-sepolia-rpc.publicnode.com`, drew the payment QR, and showed the send form. No API key and no funded key anywhere.
  - Build output: `index` 669.2 kB (213.7 kB gzip), with `libsodium-wrappers` still split into its own 533.9 kB chunk.
  - Lint note for future milestones: the React Compiler-era hooks rules (`react-hooks/set-state-in-effect`, `react-hooks/refs`) are **errors** here. A callback that touches a ref cannot be put into a memoized context value, and a function that sets state synchronously cannot be called straight from an effect — the wallet provider derives its service during render and tags loaded state with the service that produced it instead of guarding with a mutable counter.

- **Milestone 5**: 544 tests passing across 28 files (2 more skipped), 77 of them new — `messaging/envelope` 23, `messaging/service` 17, `messaging/identity` 13, `messaging/waku` 11, `ui/messaging-context` 13, plus the plaintext-at-rest scan extended to chat records. Whole suite runs in ~31 s on this machine.
  - Live Waku, opt-in (`WAKU_LIVE=1 npx vitest run --environment node src/messaging/waku.live.test.ts`): **2 tests pass** — a transport frame round-trip in 6.6 s, and two live light nodes exchanging a sealed DM end to end in 11.3 s, including peer discovery on the public network.
  - Live two-browser check on the built app (Chromium, real Waku network, real Argon2id): two tabs on different origins (`127.0.0.1` and `localhost`), each with its own vault, its own identity (`oblivion1AwmNNW…K7LPB` / `oblivion1A5zlp-…RTwF2aO`) and its own fingerprint, both connected to Waku. They computed the _same_ conversation id from each other's identity string (`293cbe184e4fc706bae264717df9990c`, topic `/oblivion/1/293cbe18…/proto`), and a message sent from either tab appeared in the other's thread in both directions. The relay saw opaque payloads: neither tab had the other's key, and the message bodies exist only inside the two encrypted vaults.
  - End-to-end: 2 Playwright tests still passing; the Waku SDK never loads in CI (it is behind a lazy import in the Waku path only).
  - Build output: `index` 690.0 kB (219.5 kB gzip), `libsodium-wrappers` lazily split at 533.9 kB (189.1 kB gzip), the **Waku SDK lazily split at 849.5 kB (258.2 kB gzip)** and the adapter itself 2.6 kB — none of it fetched until a transport starts.
  - **Negative result**: `npm install @waku/sdk@0.0.36` adds **6 vulnerabilities (2 moderate, 4 high)** through `@waku/discovery`/`libp2p`/`uuid <11.1.1`. `npm audit` reports them; `npm audit fix --force` "resolves" them only by downgrading to `@waku/sdk@0.0.16`, which is a breaking downgrade of a core dependency. CI therefore reports `npm audit` without failing the build, as it has since milestone 1. Nothing about the audit is hidden.
  - SDK notes for future work: `waitForPeers` matches the SDK's `Protocols` enum values (`lightpush`, `filter`), not `/vac/…` multiaddrs, and the encoder/decoder must come from the _node_ (`node.createEncoder`), not the module, because the node's factory fills in the routing info the Filter subscription needs.
  - Bug found and fixed while wiring the UI: both `WalletProvider` and `MessagingProvider` memoized their service on the whole vault document, so _every_ vault write — every message stored — rebuilt the service and its subscriptions. Both now derive from stable primitives (mnemonic, address index, address) instead.
  - React Compiler-era lint notes (these rules are errors here): a callback that closes over a ref cannot live in a memoized context value, and a function that sets state synchronously cannot be called straight from an effect — the providers use `void (async () => { … })()` and derive state during render rather than in an effect.

- **Milestone 7**: a documentation milestone, so its numbers are the ones it describes. `npm run verify` green on the milestone-6 code: 589 tests across 30 files (2 skipped), build, and 2 Playwright tests in 5.2 s. The only code edits that came with it are `MILESTONES_DONE = 7`, the dashboard's build-status copy and the dashboard test — all covered by the suite.
  - `docs/SECURITY.md` is written from the code, not from memory: every section names the module and the test file behind it, and the claims that cannot be tested here (an audit; a privacy bubble around the whole app) are stated as absent rather than implied.
  - Deliberately in the "not defended" list instead of left implicit: the header-level gaps a meta policy cannot close, unzeroable JavaScript strings, the unkeyed conversation-id hash, unpadded lengths, mutable Action tags, and the `@waku/sdk` audit finding. (Milestone 8 then closed the biggest of them with the policy described below.)
- **Milestone 6**: 589 tests passing across 30 files (2 more skipped), 44 of them new — `messaging/payments` 23, `messaging/service` 28 (11 new), `ui/messaging-context` 19 (6 new), `vault/schema` 46 (4 new). Whole suite runs in ~36 s on this machine.
  - Build output: `index` 702.0 kB (222.2 kB gzip), `libsodium-wrappers` 533.9 kB (189.1 kB gzip), the Waku SDK 849.5 kB (258.2 kB gzip), the Waku adapter 2.6 kB, `ccip` 2.9 kB, CSS 6.3 kB (2.0 kB gzip).
  - Protocol note: the message `kind` sits inside the canonical header (between the ephemeral public key and the timestamp), so it is covered by both the compact signature and the AEAD's associated data. Re-labelling a frame fails to open or fails verification; tests assert both directions.
  - Codec note: amounts travel as decimal strings (JSON has no bigint), and a request **must** name its chain (`payToChainId`). A body without a chain is refused rather than assumed, which is what keeps a mainnet request from being smuggled into a testnet app.
  - UI note: the fee is fetched by an effect on the card itself, so Pay stays disabled until the fee is known; the decline path publishes a receipt and a test asserts the fake sender recorded zero submissions.

- **Milestone 8**: the report script is in and CI runs `npm run report:check`, the demo is recorded, and `v2.0.0` points at it. Its own verification:
  - `npm run report` on this machine produced the committed `docs/report.json` and the README block: **597 tests across 31 files (2 skipped) in a 32.9 s wall run**, 3 Playwright tests in 4 s, Argon2id at 0.19 s, `npm audit` reporting the 6 advisories (2 moderate, 4 high), and the four rows it deliberately refuses to guess (two live Waku, RPC response times, mobile). The file was regenerated after the demo's artifacts were committed; the run before that measured 589 tests in 30 files and 42.8 s, and the committed JSON is the later one.
  - The live rows were exercised by hand: `WAKU_LIVE=1 npm run report -- --only=live` measured a transport frame in **10.4 s** and a two-node sealed DM in **10.8 s**. Those are not in the committed table — a live number only appears there when a run opts in on the machine that takes it, so the committed table says `not measured` for both.
  - The Content-Security-Policy was verified in a real browser, not only in tests: `vite preview` on the built app, a vault created end to end (so Argon2id and XChaCha20-Poly1305 ran under the policy), and a console with **zero messages** — no CSP violation, no error — while the lazy libsodium chunk was fetched and executed. The built `index.html` carries the policy, which is the same document `e2e/smoke.spec.ts` now asserts.
  - **Negative result, and the reason the live rows are opt-in: the public network is not always reachable.** Three runs of the live file during this session behaved differently: the frame test failed twice in a row with `MessagingError: no Waku peer accepted the message` (LightPush found no peer before its timeout) while the two-node DM test passed in 10.1 s, and a later run passed both (10.4 s / 10.8 s). Peer discovery, not the envelope, is what varies; this is exactly why a live figure is reported with its run and never as a constant. (Before the recording below, another opt-in run passed both again — 8.4 s and 9.3 s — so the network was reachable that evening; the variance is the point.)
  - **The demo recording, and what is real in it.** `npm run demo` on the built app, two origins (`127.0.0.1:4183` and `:4184`), two vaults created by the script itself. Both tabs were on the public Waku network about 3 s after the click; a wallet address pasted into the contacts field was refused with `not a contact identity: identity must start with "oblivion1"` and your own identity with `that is your own identity`; the two sides computed the same topic (`/oblivion/1/<32 hex>/proto`) from each other's identity strings alone; a sealed message crossed each way within seconds; the vault record read straight out of IndexedDB was a 1 617-character `oc1.…` envelope whose KDF parameters, salt and ciphertext contained none of the demo password, the wallet address, the chat identity or the message text (the panel says which); the payment request arrived as a card; the decline receipt reached the requester in about 3 s. One recording is about 55 s per screen, and the frames are committed — re-encoded by the script itself (`-c:v libvpx -b:v 350k -r 15 -an`, so 1280×800 VP8, 15 fps, no audio; ~1 MB a minute instead of 3) but never cut.
  - **Negative result, and the one shot this machine cannot take: there is no funded key, so the demo does not contain a real payment.** On the live endpoint the payer's own wallet refused the transaction before it was even assembled — `eth_estimateGas` answered `EVM error: OutOfFunds`, the card said so in one sentence (_“This wallet does not hold enough Sepolia ETH to cover the amount plus the fee. Send testnet ETH to the address above and try again.”_), `Pay` stayed disabled, and the recording shows the decline path instead. The paying click is recorded separately with the Sepolia endpoint replaced by the same canned responder CI uses, and every frame of that run says `chain: STUB (Sepolia faked)` in its badge. In that run the fee line read `Worst-case fee 0.00084 ETH (21000 gas at up to 40 gwei), so 0.00184 ETH has to be available`, one transaction reached the stub, and the hash came back through the sealed thread **1.4 s** after the click. A funding step is documented (`demo:prepare` → fund → `demo:keep`) so the real version is one faucet visit away.
  - **The rough edge the first recording showed is now closed, and the recording was re-taken to prove it.** With an unfunded payer the card used to render viem's provider error verbatim: a multi-line `OutOfFunds` trace with the endpoint URL and the request body in it, in red, inside a payment card. The wallet's error path now classifies provider failures (`src/wallet/error-text.ts` — out of funds, endpoint unreachable, rate-limited, otherwise the provider's headline plus the `Details:` line that carries the real reason, never more than one line and never the request body), `describeWalletError` routes everything that is not one of our own `WalletError`s through it, and the raw dump is left where viem already writes it: the browser console. The tests pin the classifier against the exact dump the live demo produced, and `docs/demo` was re-recorded so the committed frames show the condensed sentence rather than the trace.
  - Three attempts at the recording were needed, each for a different reason, all fixed in the script rather than worked around in the edit: the first checked for the vault gate's heading with `isVisible()` immediately after `goto` (so it decided "a vault exists" before React had rendered and then waited for a gate that was not coming); the second picked payment cards by index, which broke on a re-run against a profile that already held a thread (the recorder now wipes the demo profile by default and picks cards by their own note text); the third waited for the string `declined` while the UI writes `Declined.` — the casing was the whole failure.

- **The first push** (2026-09-27): the work went up as [mit37/oblivion](https://github.com/mit37/oblivion) — public, default branch `main`, 14 commits and the annotated `v2.0.0` tag — and the Pages site is live at https://mit37.github.io/oblivion/. The first CI run went red on the secret scan alone, having scanned nothing: `gitleaks-action@v2` derives its range from the push event as `<parent of the first pushed commit>^..<head>`, and on a repository's first push that commit is the root, so `git log` answered `fatal: ambiguous argument` and the job surfaced `Unexpected exit code [1]`. The action exposes no range override, so the job now installs the pinned 8.24.3 binary and scans the whole history. That scan read 15 commits / 1 MB and found four things, all test data: a fabricated ERC-20 address in `src/wallet/format.test.ts`, the published BIP-39 derivation for the "abandon … about" mnemonic, and two Argon2id outputs captured from the pinned libsodium build. `.gitleaks.toml` names those four values rather than the two files, so a real credential pasted into either file still fails the scan. The same binary then ran on this machine — the local gate that had never been run — and reported `no leaks found` over the same 15 commits, while a control secret piped through `gitleaks stdin` still tripped its rule, which is how the allowlist was checked for being narrow rather than a mute. Run [36287032091](https://github.com/mit37/oblivion/actions/runs/36287032091) is green in both jobs, and the Pages deploy [36287032119](https://github.com/mit37/oblivion/actions/runs/36287032119) succeeded beside it.

## What is left

The build is finished, pushed, tagged and green, and all eight milestones are done. Two things are left, and both need somebody other than this machine:

- **The green runs do not include the tag's own commit.** `v2.0.0` points at `1856f71`, and that commit's secret-scan job is red: it ran before the pinned binary and `.gitleaks.toml` existed, so the red is the tool's first-push bug and not a finding. The fix lives in the commits after the tag, so `git describe` at `main` reads past `v2.0.0` rather than at it. Moving a published tag would erase that evidence — the red run is the record of a real bug — so the tag stays where it is and this note is the explanation instead
- **Record the funded payment.** `npm run demo:prepare` prints the payer's address, a faucet funds it, `npm run demo:keep` records the same two vaults paying for real, and the README's demo line can then drop its caveat.
