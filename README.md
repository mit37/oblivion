# Oblivion

> **v2 (2026 rebuild).** The original prototype's code was not preserved; this is a clean re-implementation of the same design. Numbers in this README come from this codebase.

A privacy-first messenger and wallet prototype: Waku end-to-end encrypted messaging, an Ethereum testnet wallet, and one encrypted local vault.

> [!WARNING]
> **Prototype, unaudited, testnet only (Ethereum Sepolia).**
> Do not use with real funds or sensitive conversations. Mainnet is a non-goal of this prototype.

[![CI](https://github.com/mit37/oblivion/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mit37/oblivion/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Build status — milestone 3 of 8 is complete.** The crypto core and the encrypted vault are built and tested, with a working app: create a vault, write down the recovery phrase, confirm three words, unlock, auto-lock, change the password, reveal the phrase or delete the vault. The wallet, messaging, pay-in-chat and the security write-up are milestones 4–8. Progress and evidence live in [`docs/PLAN.md`](docs/PLAN.md).

## The thirty-second version

Your messages and your money usually live in two apps owned by two companies, and both know too much. Oblivion puts both behind **one password-derived encrypted vault on your device**: peer-to-peer encrypted chat over the Waku network (no central server storing messages) and an Ethereum wallet, **locked to the Sepolia testnet**.

The interesting part is what the vault refuses to do. Argon2id (64 MiB, 3 passes) turns your password into a vault key; XChaCha20-Poly1305 seals one versioned document that holds the mnemonic, contacts, history and payment records. A single mnemonic derives two _unrelated_ identities — the wallet at `m/44'/60'/0'/0/0` and the chat key at `m/44'/60'/1'/0/0` — so a contact who knows your chat public key cannot find your wallet address. A record that asks for weaker KDF parameters than this build accepts is refused rather than opened.

## What's in it

| Capability                                                                                     | Status         |
| ---------------------------------------------------------------------------------------------- | -------------- |
| App shell, CI, static GitHub Pages deploy                                                      | ✅ milestone 1 |
| Crypto core: Argon2id KDF, XChaCha20-Poly1305 AEAD, BIP-39/44 derivation, signatures           | ✅ milestone 2 |
| Encrypted vault: create / unlock / lock / re-wrap, IndexedDB, auto-lock, backup + confirm flow | ✅ milestone 3 |
| Sepolia wallet: balance, receive (QR), send, history, ERC-20 view, mainnet refusal             | ⏳ milestone 4 |
| Waku 1:1 end-to-end encrypted messaging                                                        | ⏳ milestone 5 |
| Pay-in-chat payment requests                                                                   | ⏳ milestone 6 |
| Security write-up (`docs/SECURITY.md` threat model)                                            | ⏳ milestone 7 |
| Demo recording + `v2.0.0` tag                                                                  | ⏳ milestone 8 |

## Results

Every number below was produced by this repo on 2026-09-25 (Node 24.20.0, Windows), with the command shown. Anything that cannot be measured here is reported as "not measured".

| Measurement                                      | Value                        | Command                                  |
| ------------------------------------------------ | ---------------------------- | ---------------------------------------- |
| Unit tests (Vitest)                              | 330 passing, 16 files, ~21 s | `npm test`                               |
| - crypto module                                  | 175 tests                    | `npx vitest run src/crypto`              |
| - vault module                                   | 130 tests                    | `npx vitest run src/vault`               |
| - app + UI                                       | 25 tests                     | `npx vitest run src/App.test.tsx src/ui` |
| End-to-end (Playwright, Chromium, built app)     | 1 passing                    | `npm run test:e2e`                       |
| Production bundle, app chunk                     | 400.6 kB (133.8 kB gzip)     | `npm run build`                          |
| Production bundle, lazily loaded libsodium chunk | 533.9 kB (189.1 kB gzip)     | `npm run build`                          |
| Argon2id at the default `interactive` profile    | ~0.41 s per derivation       | `npx vitest run src/crypto/kdf.test.ts`  |

Not measured here, and why: live Waku network latency, real Sepolia RPC response times and on-device mobile numbers. All three need outbound network access or hardware the build environment does not have; milestone 8 adds a report script (`npm run report`) that regenerates the table above, and the live demo numbers stay Mitansh's to record.

Deliberately weak profile: the `test` KDF profile (8 MiB, 1 pass) exists only so the suite stays fast. It cannot be selected without an explicit opt-in flag that the app never sets, and a stored record requesting those parameters is refused.

## Architecture

```
UI (React 19 + TypeScript + Vite)
 ├─ VaultProvider      unlock state, auto-lock timer, activity listeners
 ├─ VaultGate          create / unlock, mnemonic backup + confirm-words steps
 ├─ Dashboard          identity, auto-lock, password re-wrap, phrase reveal, delete
 └─ useVault()         one context: create/unlock/lock/update/changePassword/destroy

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
- End-to-end: `npm run test:e2e` (Playwright, Chromium, against the production build served by `vite preview`).
- CI runs lint, format check, typecheck, unit tests, build, Playwright and gitleaks on every push and pull request, and reports `npm audit` without failing the build.

## What this does not do

- **Not audited, and testnet only.** Mainnet is refused in code (milestone 4) and covered by a test. Do not use it with real funds.
- **No wallet and no messaging yet.** Milestones 4–6 are unbuilt: there is no balance, no send, no chat and no pay-in-chat. The vault holds the identity those features will use, nothing more.
- **No recovery.** Lose the password and the phrase and the data is gone; there is no server, no reset link and no support desk.
- **No protection against a compromised device.** Malware, a keylogger or someone with your unlocked session can read what you can read. See `docs/SECURITY.md` (milestone 7) for the full threat model.
- **No metadata privacy on the network.** Milestone 5 sends messages through Waku; the relay can see that _some_ peer received traffic, not what it said.
- **No telemetry, no analytics, no logging of key material.** `no-console` is an ESLint error in `src/`.
- **Never planned:** mainnet, group chats, swaps/DEX, NFTs, custodial anything, or a mobile-native app (PRD non-goals).

## Design decisions

- **One vault, two identities.** The mnemonic derives the wallet at `m/44'/60'/0'/0/<i>` and the chat key at `m/44'/60'/1'/0/0`. Different BIP-44 branches, so a chat contact cannot link your messages to your wallet address. Trade-off: one backup covers both, so the phrase is worth more to an attacker.
- **Refuse weak parameters instead of trusting the record.** The stored KDF parameters are re-validated on unlock, and anything below the `interactive` profile is rejected (`UnusableRecordError`). Trade-off: a hand-edited record is unopenable, which is the intended behaviour.
- **One error for a wrong password and a damaged vault.** `DecryptionFailedError` collapses into a single message, so an attacker learns nothing from the failure mode. Trade-off: the user cannot tell the two apart either.
- **Standards only, no hand-rolled crypto.** Argon2id and XChaCha20-Poly1305 come from `libsodium-wrappers-sumo`; derivation from `@scure/bip39`/`@scure/bip32`; curve operations and wallet accounts from `@noble/curves` and `viem`. Trade-off: a 534 kB lazily loaded WASM chunk.
- **All randomness from one place.** WebCrypto's `crypto.getRandomValues` produces salts and AEAD nonces; libsodium is used only for the KDF and the AEAD, so there is one entropy story to review.
- **Reload always starts locked.** The vault key is never persisted, not even session-scoped. Trade-off: unlock costs an Argon2id derivation (~0.41 s) every time the tab is refreshed.

## Credits & licenses

MIT — see [LICENSE](LICENSE). Built with AI coding agents (Freebuff/GLM) under my direction; design, specs, review and evaluation are mine.

Repo plan and rules: [`PRD.md`](PRD.md), [`STANDARDS.md`](STANDARDS.md), [`docs/PLAN.md`](docs/PLAN.md).
