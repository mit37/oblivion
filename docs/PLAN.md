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
- [ ] No plaintext at rest (test-scanned)
- [ ] Two-party E2EE chat + pay-in-chat demo recorded on testnet
- [ ] `docs/SECURITY.md` threat model; "unaudited, testnet only" banner in app + README
- [ ] CI green; tag v2.0.0

---

## Milestones (PRD §5)

### 1. Scaffold, CI, static deploy — **complete**

- [x] Vite + React + TypeScript app shell with the mandatory safety banner (`src/safety.ts`)
- [x] ESLint (flat config) + Prettier + `tsc --noEmit`, enforced in CI
- [x] Vitest smoke test (jsdom + Testing Library, RTL cleanup in `src/test/setup.ts`)
- [x] Playwright smoke test against the production build (`vite preview`)
- [x] GitHub Actions `ci.yml`: lint → format check → typecheck → unit tests → build → Playwright → gitleaks, with `npm audit` reported (non-blocking)
- [x] GitHub Actions `pages.yml`: static deploy to GitHub Pages with `VITE_BASE=/oblivion/`
- [x] `PRD.md`, `STANDARDS.md`, `AGENTS.md`, `CLAUDE.md` copied into the repo root
- [x] Local verification on Node 24 / Windows: `lint`, `format:check`, `typecheck`, `test` (2 passing), `build` and `test:e2e` (1 passing) all green
- [ ] CI green on GitHub (requires the repo to exist remotely; everything passes locally — see the log below)
- [ ] `gitleaks detect` locally before the first push (the gitleaks binary is not installed on this machine; the CI secret-scan job covers every push and pull request)

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

### 5. Waku messaging — not started

- [ ] `@waku/sdk` light node (LightPush + Filter, Store for history where available)
- [ ] Contacts added by exchanging a QR or public-key string
- [ ] 1:1 chats, content topic `/oblivion/1/dm/<conv-id>/proto`, payloads encrypted end to end
- [ ] Message history saved in the vault
- [ ] Two in-process nodes in tests where feasible; otherwise mocked with a documented manual test

### 6. Pay-in-chat — not started

- [ ] Send a Sepolia payment request inside a chat
- [ ] Recipient pays with one confirmation
- [ ] Transaction hash posted back into the thread

### 7. Security write-up — not started

- [ ] `docs/SECURITY.md`: threat model (what it protects against; what it does not — compromised device, Waku metadata, RPC provider seeing addresses), crypto parameter choices, known gaps
  - Note for this section: the wallet adds one more third party to the list — the RPC provider sees the wallet address on every balance read, history scan and broadcast. That is named in the README limitations already and must be in the threat model.

### 8. Ship — not started

- [ ] README completed from the STANDARDS §4 template; every number generated by a script
- [ ] Test-count script wired into the README (no typed numbers)
- [ ] GIF (or `docs/DEMO.md` script) of two browsers chatting and paying on Sepolia
- [ ] `gitleaks detect` run locally before the first push
- [ ] Tag `v2.0.0`

---

## Cloud-instance constraints (PRD §6)

- The Waku network and public Sepolia RPC need outbound network access, which the build environment may block. **CI mocks both**, and a documented manual test covers the live path. The two-browser demo on the live testnet is recorded by Mitansh on his laptop (`docs/DEMO.md`, milestone 8).
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

## Next step

Milestone 5 (Waku messaging) is next: a `@waku/sdk` light node behind a service interface, contacts exchanged as QR/public-key strings, 1:1 chats on content topic `/oblivion/1/dm/<conv-id>/proto` with payloads encrypted end to end, and message history in the vault.
