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

- [ ] Crypto tests incl. BIP-39/44 vectors and tamper detection (≥60 tests)
- [ ] Mainnet refusal enforced by a test
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

### 3. Vault — not started

- [ ] Vault create / unlock / lock / re-wrap with a password, stored in IndexedDB (`idb`)
- [ ] Auto-lock after inactivity; manual lock
- [ ] Password change re-wraps the vault key
- [ ] Test scans stored blobs and proves no plaintext is stored
- [ ] Mnemonic backup flow with a confirm-words step

### 4. Wallet (Sepolia) — not started

- [ ] `viem` public client + wallet client; chain guard: mainnet chain ID → throws (test)
- [ ] Balance, receive (QR), send ETH with gas estimate + confirmation screen
- [ ] Transaction history via a configurable public RPC, no API key required by default
- [ ] ERC-20 balance view for a token list

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
- **Milestone 2**: 177 tests passing across 8 files — `crypto/keys` 49, `crypto/aead` 39, `crypto/kdf` 31, `crypto/encoding` 20, `crypto/vectors` 17, `crypto/signatures` 13, `crypto/random` 6, `App` 2. Whole suite runs in ~7 s on this machine.
  - Argon2id at the `interactive` profile (64 MiB, 3 passes) measured at ~0.41 s for one derivation on this machine; the `test` profile (8 MiB, 1 pass) keeps the suite fast.
  - BIP-39 seeds are checked twice: against the published Trezor vector and against Node's own PBKDF2-HMAC-SHA512, an independent implementation.
  - Cross-realm note for future milestones: inside jsdom, `TextEncoder` returns another realm's `Uint8Array`, so byte checks use a realm-agnostic tag test (`isUint8Array`) instead of `instanceof`.

## Next step

Milestone 3 (the vault) is next: create/unlock/lock/re-wrap on top of the crypto module, stored in IndexedDB, with a test that scans the stored records for plaintext.
