# Oblivion

> **v2 (2026 rebuild).** The original prototype's code was not preserved; this is a clean re-implementation of the same design. Numbers in this README come from this codebase.

A privacy-first messenger and wallet prototype: Waku end-to-end encrypted messaging, an Ethereum testnet wallet, and one encrypted local vault.

> [!WARNING]
> **Prototype, unaudited, testnet only (Ethereum Sepolia).**
> Do not use with real funds or sensitive conversations. Mainnet is a non-goal of this prototype.

[![CI](https://github.com/mit37/oblivion/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mit37/oblivion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Build status — milestone 4 of 8 is complete.** The crypto core, the encrypted vault and the Sepolia wallet are built and tested, with a working app: create a vault, write down the recovery phrase, confirm three words, unlock, auto-lock, change the password, reveal the phrase or delete the vault — and then receive testnet ETH at a QR, send it with the fee shown before signing, scan recent activity, and watch an ERC-20. Messaging, pay-in-chat and the security write-up are milestones 5–8. Progress and evidence live in [`docs/PLAN.md`](docs/PLAN.md).

## The thirty-second version

Your messages and your money usually live in two apps owned by two companies, and both know too much. Oblivion puts both behind **one password-derived encrypted vault on your device**: peer-to-peer encrypted chat over the Waku network (no central server storing messages) and an Ethereum wallet, **locked to the Sepolia testnet**.

The interesting part is what the app refuses to do. Argon2id (64 MiB, 3 passes) turns your password into a vault key; XChaCha20-Poly1305 seals one versioned document that holds the mnemonic, contacts, history and payment records. A single mnemonic derives two _unrelated_ identities — the wallet at `m/44'/60'/0'/0/0` and the chat key at `m/44'/60'/1'/0/0` — so a contact who knows your chat public key cannot find your wallet address. A record that asks for weaker KDF parameters than this build accepts is refused rather than opened, and the wallet refuses any endpoint that is not Sepolia, mainnet included, before it sends a single request.

The wallet is real: a viem client talks to a public Sepolia endpoint (no API key), your address and its EIP-681 payment QR come from the vault's own key, fees are estimated and shown before you sign, and the signing key exists only while the vault is unlocked.

## What's in it

| Capability                                                                                     | Status         |
| ---------------------------------------------------------------------------------------------- | -------------- |
| App shell, CI, static GitHub Pages deploy                                                      | ✅ milestone 1 |
| Crypto core: Argon2id KDF, XChaCha20-Poly1305 AEAD, BIP-39/44 derivation, signatures           | ✅ milestone 2 |
| Encrypted vault: create / unlock / lock / re-wrap, IndexedDB, auto-lock, backup + confirm flow | ✅ milestone 3 |
| Sepolia wallet: balance, receive (QR), send, history, ERC-20 view, mainnet refusal             | ✅ milestone 4 |
| Waku 1:1 end-to-end encrypted messaging                                                        | ⏳ milestone 5 |
| Pay-in-chat payment requests                                                                   | ⏳ milestone 6 |
| Security write-up (`docs/SECURITY.md` threat model)                                            | ⏳ milestone 7 |
| Demo recording + `v2.0.0` tag                                                                  | ⏳ milestone 8 |

## Results

Every number below was produced by this repo on 2026-09-25 (Node 24.20.0, Windows), with the command shown. Anything that cannot be measured here is reported as "not measured".

| Measurement                                           | Value                                                | Command                                  |
| ----------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Unit tests (Vitest)                                   | 467 passing, 23 files, ~28 s                         | `npm test`                               |
| - crypto module                                       | 175 tests                                            | `npx vitest run src/crypto`              |
| - vault module                                        | 135 tests                                            | `npx vitest run src/vault`               |
| - wallet engine                                       | 88 tests                                             | `npx vitest run src/wallet`              |
| - app + UI (wallet panel and QR included)             | 69 tests                                             | `npx vitest run src/App.test.tsx src/ui` |
| End-to-end (Playwright, Chromium, built app)          | 2 passing                                            | `npm run test:e2e`                       |
| Production bundle, app chunk                          | 669.2 kB (213.7 kB gzip)                             | `npm run build`                          |
| Production bundle, lazily loaded libsodium chunk      | 533.9 kB (189.1 kB gzip)                             | `npm run build`                          |
| Argon2id at the default `interactive` profile         | ~0.41 s per derivation                               | `npx vitest run src/crypto/kdf.test.ts`  |
| Fee shown for a 0.001 ETH send at a 20 gwei gas price | 0.00084 ETH (worst case, 21 000 gas × a 40 gwei cap) | `npx playwright test e2e/wallet.spec.ts` |

Not measured here, and why: live Waku network latency, real Sepolia RPC response times and on-device mobile numbers. Waku is unbuilt and the other two need hardware or a funded network this build environment does not have; milestone 8 adds a report script (`npm run report`) that regenerates the table above, and the live demo numbers stay Mitansh's to record. The one network figure above is deliberately a _stubbed_ endpoint's response, so it is reproducible in CI without outbound access.

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
 └─ useVault() / useWallet()   two contexts, both derived from the unlocked document

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

src/vault/
 ├─ schema.ts       versioned document, migration, defaults, validation
 ├─ vault.ts        create/unlock/lock/update/re-wrap on top of src/crypto
 ├─ storage-idb.ts  IndexedDB record (the only thing ever persisted)
 └─ auto-lock.ts    inactivity lock with an injectable clock
```

Data at rest is exactly one IndexedDB record: `{ id, version, kdf: { algorithm, opsLimit, memLimitBytes, saltHex }, envelope, createdAt, updatedAt }`. `envelope` is `oc1.<nonce>.<aad|->.<ciphertext>` in unpadded URL-safe base64. `src/vault/no-plaintext.test.ts` scans the real database and fails if the password, the mnemonic, a derived key or an address ever appears outside the sealed envelope.

## Running it

```bash
npm ci
npm run dev        # app shell on http://localhost:5173
npm run verify     # lint, format check, typecheck, unit tests, build, E2E
```

No API keys and no configuration are needed. The first screen asks you to create a vault; the password you choose is the only way back in, and the recovery phrase is shown once (and can be revealed again later from the dashboard).

## Testing

- Unit tests: `npm test` (Vitest + Testing Library in jsdom). Crypto vectors are committed in `src/crypto/vectors.ts` with provenance for every value: published BIP-39 (Trezor), BIP-32 and BIP-44/Ethereum vectors, plus regression pins labelled with the exact library build and capture date.
- Independent checks: BIP-39 seeds are verified against Node's own PBKDF2-HMAC-SHA512 as well as the published vector, and the wallet address vectors are cross-checked against viem's account derivation.
- End-to-end: `npm run test:e2e` (Playwright, Chromium, against the production build served by `vite preview`). `e2e/wallet.spec.ts` creates a vault in a real browser and then balances, sends, checks a receipt and scans history against a **stubbed** Sepolia JSON-RPC endpoint that answers `eth_fillTransaction`, `eth_sendRawTransaction`, `eth_getReceipt` and `eth_getBlockByNumber` with fixtures. viem, the chain guard, the fee arithmetic and the UI are the real code; only the chain is canned, so CI needs no outbound network and no funded key.
- CI runs lint, format check, typecheck, unit tests, build, Playwright and gitleaks on every push and pull request, and reports `npm audit` without failing the build.

## What this does not do

- **Not audited, and testnet only.** Mainnet is refused in code (chain ID 1 throws `MainnetRefusedError`) and covered by tests in `src/wallet/chain.test.ts` and `src/ui/wallet-context.test.tsx`, which also prove nothing is fetched after the refusal. Do not use it with real funds.
- **No messaging yet.** Milestones 5–6 are unbuilt: there is no chat and no pay-in-chat. The wallet and the vault are all there is today.
- **No indexer, so history is shallow.** Recent activity comes from scanning the last 12 blocks over a public RPC (`DEFAULT_HISTORY_LOOKBACK_BLOCKS`). Older transfers are simply not listed — that is a scan limit, not a balance-of-payments problem. A block explorer covers the rest.
- **The RPC provider sees your address.** Every balance read, history scan and broadcast goes to whatever endpoint is configured (`VITE_SEPOLIA_RPC_URL`, public by default), and that provider sees your IP and your address. Run your own node to avoid it.
- **No ERC-20 transfers, no approvals, no token prices.** The token view reads `name`, `symbol`, `decimals` and `balanceOf`; it never values a token in fiat and cannot move one.
- **One recipient at a time, no batching, no gas-speed choice.** Fees are whatever the endpoint suggests, doubled for headroom; there is no "slow/normal/fast" selector and no transaction replacement.
- **Desktop browser only.** No mobile build, no hardware wallet, no WalletConnect.
- **No recovery.** Lose the password and the phrase and the data is gone; there is no server, no reset link and no support desk.
- **No protection against a compromised device.** Malware, a keylogger or someone with your unlocked session can read what you can read. See `docs/SECURITY.md` (milestone 7) for the full threat model.
- **No metadata privacy on the network.** Milestone 5 sends messages through Waku, where a relay can see that _some_ peer received traffic and how much of it, just not what it said. And for the wallet, an RPC provider sees your address (above); there is no Tor or mixnet mode.
- **No telemetry, no analytics, no logging of key material.** `no-console` is an ESLint error in `src/`.
- **Never planned:** mainnet, group chats, swaps/DEX, NFTs, custodial anything, or a mobile-native app (PRD non-goals).

## Design decisions

- **One vault, two identities.** The mnemonic derives the wallet at `m/44'/60'/0'/0/<i>` and the chat key at `m/44'/60'/1'/0/0`. Different BIP-44 branches, so a chat contact cannot link your messages to your wallet address. Trade-off: one backup covers both, so the phrase is worth more to an attacker.
- **Refuse weak parameters instead of trusting the record.** The stored KDF parameters are re-validated on unlock, and anything below the `interactive` profile is rejected (`UnusableRecordError`). Trade-off: a hand-edited record is unopenable, which is the intended behaviour.
- **One error for a wrong password and a damaged vault.** `DecryptionFailedError` collapses into a single message, so an attacker learns nothing from the failure mode. Trade-off: the user cannot tell the two apart either.
- **Standards only, no hand-rolled crypto.** Argon2id and XChaCha20-Poly1305 come from `libsodium-wrappers-sumo`; derivation from `@scure/bip39`/`@scure/bip32`; curve operations and wallet accounts from `@noble/curves` and `viem`. Trade-off: a 534 kB lazily loaded WASM chunk.
- **Chain is a hard-coded constant, not a setting.** Sepolia's ID lives in `src/wallet/chain.ts` and the guard throws on anything else — mainnet first, with its own error, so the refusal is visible rather than generic. Trade-off: pointing the prototype at a local fork means editing code, on purpose.
- **The wallet talks through two narrow interfaces.** `ChainReader` and `ChainSender` are all `WalletService` knows, so every test drives `FakeChain` (in-memory) and the browser test stubs JSON-RPC — no test ever needs the network. Trade-off: `clients.ts` carries an explicit mapping layer where viem's types stop and ours begin.
- **Loaded state is tagged with the service that read it.** A slow reply belonging to a locked vault, or to a previous account, is ignored at render time rather than guarded by a mutable counter. Trade-off: two overlapping reads for the same service resolve last-write-wins.
- **No indexer.** History is a bounded block scan over the public RPC: no third-party API, no key, no account with a data provider. Trade-off: only recent activity shows (12 blocks by default).
- **QR codes are drawn as SVG by this repo.** `qrcode` produces the matrix and `src/ui/qr.ts` renders it (quiet zone, merged dark runs) instead of pulling in a canvas or a second image pipeline. Trade-off: ~60 lines of geometry to keep tested.
- **All randomness from one place.** WebCrypto's `crypto.getRandomValues` produces salts and AEAD nonces; libsodium is used only for the KDF and the AEAD, so there is one entropy story to review.
- **Reload always starts locked.** The vault key is never persisted, not even session-scoped. Trade-off: unlock costs an Argon2id derivation (~0.41 s) every time the tab is refreshed.

## Credits & licenses

MIT — see [LICENSE](LICENSE). Built with AI coding agents (Freebuff/GLM) under my direction; design, specs, review and evaluation are mine.

Repo plan and rules: [`PRD.md`](PRD.md), [`STANDARDS.md`](STANDARDS.md), [`docs/PLAN.md`](docs/PLAN.md).
