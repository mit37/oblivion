# PRD — Oblivion (v2 rebuild)

**Repo:** `mit37/oblivion`
**Description:** A privacy-first messenger and wallet prototype: Waku end-to-end encrypted messaging, an Ethereum testnet wallet, and one encrypted local vault.
**Topics:** `privacy`, `waku`, `ethereum`, `e2ee`, `cryptography`, `typescript`, `web3`, `prototype`
**Priority:** Tier 3 (Lab). **It must be labeled "prototype, unaudited, testnet only" everywhere.**

---

## 1. Pitch

Your messages and your money usually live in two apps owned by two companies, and both know too much. Oblivion is a prototype that puts both behind **one password-derived encrypted vault on your device**: peer-to-peer encrypted chat over the Waku network (no central server storing messages) and an Ethereum wallet, **locked to the Sepolia testnet**.

## 2. Safety posture (non-negotiable; put it at the top of the README)

- **Testnet only.** The chain ID is hard-coded to Sepolia; the code **refuses mainnet** (a test enforces it). Changing that is out of scope for v2.
- **Unaudited prototype.** Banner in the app + README: "Do not use with real funds or sensitive conversations."
- Only standard, reviewed libraries for crypto. **No hand-rolled cryptography.**
- No telemetry and no analytics. No key material ever leaves the vault unencrypted, and nothing is logged.

## 3. Goals / non-goals

**Goals**
- G1. **Vault:** created with a password. Key derivation with **Argon2id** (via `libsodium-wrappers-sumo`'s `crypto_pwhash`, with documented parameters) → a vault key; contents encrypted with **XChaCha20-Poly1305**. Stored in IndexedDB. Auto-lock after inactivity; manual lock; a changed password re-wraps the key.
- G2. **Identity:** one BIP-39 mnemonic in the vault derives (a) the Ethereum account (BIP-44 path) and (b) a separate messaging keypair (a distinct derivation path, so the chat identity isn't the wallet address). Mnemonic backup flow with a confirm-words step.
- G3. **Wallet (Sepolia):** balance, receive (QR), send ETH with a gas estimate and a confirmation screen, transaction history via a public RPC (configurable; no API key needed by default), and an ERC-20 balance view for a token list. Uses **viem**.
- G4. **Messaging:** 1:1 chats over **Waku** (`@waku/sdk`, light node: LightPush + Filter; Store for history where available). Payloads are encrypted end to end with the contacts' keys (use the Waku SDK's message encryption, ECIES/symmetric per the current docs), and contacts are added by exchanging a QR or public-key string. Message history is saved in the vault.
- G5. **Pay-in-chat:** send a Sepolia payment request inside a chat; the recipient can pay it with one confirmation, and the tx hash is posted back into the thread.
- G6. A web app (PWA) runnable locally and hostable on GitHub Pages as a static site.

**Non-goals:** mainnet, group chats, swaps/DEX, NFTs, custodial anything, a mobile-native app, an audit.

## 4. Architecture

```
UI (React + TS + Vite)
 ├─ VaultProvider (unlock state; lock on idle)
 ├─ WalletService (viem publicClient + walletClient; chainId guard = Sepolia)
 ├─ MessagingService (Waku light node; content topic /oblivion/1/dm/<conv-id>/proto)
 └─ Store (IndexedDB via idb; every record encrypted with the vault key)
crypto/  kdf.ts (Argon2id), aead.ts (XChaCha20-Poly1305), keys.ts (BIP-39/44 derivation)
         → all pure functions, heavily tested; test vectors committed
```

## 5. Milestones

1. Scaffold, CI (lint, typecheck, Vitest, Playwright, gitleaks, `npm audit` reported), static deploy to Pages.
2. Crypto module with tests: KDF parameters, AEAD round-trips, tamper detection (a flipped byte → decrypt fails), and the key derivation matching **published BIP-39/BIP-44 test vectors**.
3. Vault create/unlock/lock/re-wrap + IndexedDB storage; tests that nothing is stored in plaintext (scan the stored blobs).
4. Wallet on Sepolia: balance/receive/send/history; the chain guard test (mainnet chain ID → throws).
5. Waku messaging: contacts, 1:1 E2EE chat, history. Integration test with two in-process nodes where feasible; otherwise mocked, with a documented manual test.
6. Pay-in-chat flow.
7. Security write-up `docs/SECURITY.md`: threat model (what it protects against, and what it doesn't: a compromised device, metadata on the Waku network, RPC provider seeing addresses), crypto parameter choices, known gaps.
8. README with the safety banner, GIF of two browsers chatting and paying on testnet, tag v2.0.0.

## 6. Cloud-instance constraints

The Waku network and public Sepolia RPC need outbound network access, which the cloud instance may block. Mock them in CI, and do the live two-browser demo on Mitansh's laptop (`docs/DEMO.md`). Testnet ETH comes from a public Sepolia faucet (Mitansh gets it himself).

## 7. Definition of Done

- [ ] Crypto tests incl. BIP-39/44 vectors and tamper detection (≥60 tests)
- [ ] Mainnet refusal enforced by a test
- [ ] No plaintext at rest (test-scanned)
- [ ] Two-party E2EE chat + pay-in-chat demo recorded on testnet
- [ ] `docs/SECURITY.md` threat model; "unaudited, testnet only" banner in app + README
- [ ] CI green; tag v2.0.0
