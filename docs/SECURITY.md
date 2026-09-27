# Security and threat model

**Prototype, unaudited, testnet only (Ethereum Sepolia).**

This document says what Oblivion v2 defends against, what it does not, and where in the code each claim lives. It covers milestones 1–6 as they exist on 2026-09-26: the crypto core, the encrypted vault, the Sepolia wallet, 1:1 Waku messaging and pay-in-chat.

It is **not an audit**. Nothing here was produced by a security review; it is the builders' own honest account of their own design. Where a claim is unproven, it says so. Where a number is unmeasurable, it says that too (`STANDARDS.md` §1.3). Do not use this software with real funds or sensitive conversations.

---

## 1. Assets

| Asset                                      | Where it lives                                                                   | What protects it                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Recovery phrase (BIP-39 mnemonic)          | Inside the sealed vault document, in one IndexedDB record                        | Argon2id → XChaCha20-Poly1305; a reveal in the dashboard asks for the password again        |
| Wallet private key (`m/44'/60'/0'/0/<i>`)  | Nowhere at rest; derived in memory from the mnemonic while the vault is unlocked | The vault, plus the lock that drops it                                                      |
| Messaging private key (`m/44'/60'/1'/0/0`) | Same                                                                             | Same                                                                                        |
| Message bodies, contacts, payment ledger   | Inside the sealed vault document                                                 | Same                                                                                        |
| Vault key (32 bytes)                       | Memory only                                                                      | Zeroed with `.fill(0)` on lock; a reload always starts locked                               |
| Per-message ephemeral key                  | Memory only, one message                                                         | Discarded by the sender after sealing                                                       |
| Password                                   | Never stored                                                                     | Argon2id; a wrong password is indistinguishable from a damaged vault (`WrongPasswordError`) |

One caveat on the vault key: `lock()` zeroes the key buffer and drops the decrypted document, but the document is ordinary JavaScript data — the mnemonic is a `string`, which cannot be zeroed. A copy may survive in the engine's heap until garbage collection, and an operating-system swap file or a suspended/hibernated machine can write process memory to disk outside the app's control. That is a property of the platform, not a choice this prototype made, and it is listed again in §4.

## 2. Trust boundaries

```
password ──Argon2id(16-byte salt, 64 MiB, 3 passes)──▶ vault key (32 B)
                                                        │ XChaCha20-Poly1305, AAD = "oblivion/vault/v1" + salt
                                                        ▼
                                        one IndexedDB record (the only persisted byte)
mnemonic ──BIP-39 seed──▶ BIP-32/44 ──┬─▶ wallet key    m/44'/60'/0'/0/<i>   ──▶ viem ──▶ RPC provider ──▶ Sepolia
                                       └─▶ chat key      m/44'/60'/1'/0/0
message ──ephemeral secp256k1 ECDH──▶ HKDF-SHA256(salt = conversation id)──▶ XChaCha20-Poly1305
        ──▶ signed header + sealed body ──▶ Waku light node ──▶ relay peers on /oblivion/1/<conv-id>/proto
```

Everything left of the arrows is on your device. The two arrows that leave it are the RPC provider (wallet) and a Waku relay (chat). Both are named in §5 and §6; neither is trusted with plaintext, and neither is hidden.

## 3. What the design protects

### 3.1 A network observer, including a Waku relay

The relay carries one opaque payload per message. The body is sealed to a key derived from a **fresh ephemeral secp256k1 key pair generated for that one message** and the recipient's messaging public key; the header is signed by the sender. A relay therefore sees a topic, a size, a timing and an IP address, and nothing else: not the text, not the sender, not the recipient, not the sender's wallet address. `src/messaging/envelope.ts` and the tests in `src/messaging/envelope.test.ts` (23) and `src/messaging/service.test.ts` (28) pin this, including a test that the identity key does not appear in the ciphertext.

The content topic itself is derived from **both** public keys: `sha256("<keyA>:<keyB>")` over the sorted keys, truncated to 32 hex characters (`conversationIdFor`, `src/messaging/identity.ts`). Neither side is told the id and a third party who holds only one public key cannot compute it. A party who holds _both_ keys can compute it — the hash is unkeyed — but the topic is not a secret in the threat model; it is an addressing scheme that avoids a shared, guessable namespace.

### 3.2 Someone who steals the device at rest

A browser profile, a disk image or a synced folder yields exactly one record: `{ id, version, kdf: { algorithm, opsLimit, memLimitBytes, saltHex }, envelope, createdAt, updatedAt }`. The password is checked by Argon2id (64 MiB, 3 passes) and the document opens only with the key that comes out; a wrong password and a damaged vault both surface as one error, so the failure mode tells an attacker nothing. `src/vault/no-plaintext.test.ts` (11 tests) scans the real IndexedDB contents and fails if the password, the mnemonic, a derived key, an address, a contact label, an identity string, a conversation id, a topic string or a message body ever appears in the clear — with a control test that reopens the record and reads a body back, so the scan is not vacuously passing.

A tampered record cannot downgrade the work factor either: stored parameters are re-validated on unlock and anything below the `interactive` profile is refused (`UnusableRecordError`, `src/vault/vault.ts`). The deliberately weak `test` profile exists for the suite only and is gated behind an opt-in flag that the app never sets.

### 3.3 A hostile or curious chat contact

The signature is verified against the `senderPublicKey` in the header, and the caller may require that key to be the contact it expects; a frame on the wrong topic, in the wrong conversation, or from the wrong key is rejected rather than displayed (`openMessage`, `assertConversationId`). Because the message `kind` is part of the signed header and of the associated data, a contact cannot take a text frame and re-label it as a payment request, nor turn a request into a receipt; both directions are tested in `src/messaging/service.test.ts`. An unknown kind is refused, not guessed at.

A frame that cannot be opened is reported to `onRejected` and shown in the panel as an error, never as a message.

### 3.4 The wallet's chain guard

The chain ID is a constant (`SEPOLIA_CHAIN_ID = 11_155_111`). Chain 1 throws `MainnetRefusedError` with its own class; anything else throws `UnsupportedChainError`; tests in `src/wallet/chain.test.ts` and `src/ui/wallet-context.test.tsx` assert the refusal _and_ that no request is made after it. The RPC resolver accepts only absolute `http(s)` URLs, and the signing key exists only while the vault is unlocked.

### 3.5 Pay-in-chat

A request is a sealed chat message of kind `payment-request` whose body is JSON `{ requestId, payTo, amountWei, note, payToChainId }`; a receipt is `{ requestId, status, txHash, settledAt }` (`src/messaging/payments.ts`, 23 tests). Amounts travel as decimal strings because JSON has no integer bigint. A request **must** name its chain, and the service runs that through the wallet's own guard before anything is published: a mainnet request throws and publishes nothing (asserted), and a request naming no chain is refused rather than assumed to be Sepolia. The amount and the payee address never appear on the wire in the clear (asserted).

The recipient's side arms its Pay button only after the fee has been fetched and displayed — gas, cap, worst-case fee and the total that must be available — and the wallet re-checks the balance against amount plus worst-case fee before signing. A shortfall disables the button and says so. Declining publishes a receipt and makes no chain call (a test asserts the fake sender recorded zero submissions). The ledger lives in the vault and records `role: requested` or `received`, the amount, the payee and the outcome; a receipt for a request this vault never held updates no row.

## 4. What is explicitly not defended

- **A compromised device or a malicious browser extension.** Malware, a keylogger, a screen recorder or an injected same-origin script can read what you can read, including the unlocked vault document and the password as you type it. There is no secure enclave, no OS keystore and no hardware wallet support.
- **Cross-site scripting.** The app renders through React, never uses `dangerouslySetInnerHTML`, `eval` or `new Function`, and stores nothing in `localStorage` or cookies. The production build adds a Content-Security-Policy through a `<meta http-equiv>` tag (`src/security/csp.ts`, injected by `vite.config.ts` at build time only, asserted by `e2e/smoke.spec.ts`): `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` (no `'unsafe-inline'`, so an injected inline script does not run), `connect-src 'self' https: wss:` (the wallet's endpoint and the Waku light node's peers are chosen at runtime, so this directive is broad by necessity and named as such), `style-src 'self' 'unsafe-inline'` (React sets `style` attributes), `object-src`, `base-uri` and `form-action` all `'none'`. What the policy cannot do is as important: GitHub Pages sets no response headers, so there is **no `frame-ancestors`** (clickjacking is not prevented — `frame-ancestors` is ignored in a `<meta>` policy) and no HSTS, and the policy is a mitigation, not a substitute for an audit.
- **Memory hygiene at the level of a native app.** As §1 says: the vault key is zeroed, the decrypted document is a JavaScript value that cannot be.
- **Traffic analysis beyond what §5 lists.** Message length is not padded and is only a few bytes larger than the plaintext, so a relay can estimate how much was said, and when. Payment messages are recognisably JSON-shaped by length. Timing correlations across a conversation are not defended.
- **Waku protocol-level attacks.** A light node gets its peers from the SDK's default bootstrap list (or `VITE_WAKU_BOOTSTRAP_PEERS`); those peers see the connecting IP and the topics subscribed to, and a peer that goes away or lies can cause outage or message loss. No mixnet, no Tor, no cover traffic, no peer pinning.
- **Replay and freshness.** `sentAt` is parsed as a timestamp but never bounded against the current time, so a captured frame can be replayed to the topic it came from. It re-opens (the signature is still valid) and the vault drops it as a duplicate because message ids are stable per `(conversation, sentAt, body)` — a local dedupe, not a protocol-level replay defence. The same applies to a replayed payment request: a request has no expiry (§7).
- **Forward secrecy, post-compromise healing and deniability.** These are absent, not partial. The recipient's long-term private key plus the ephemeral public key in a captured frame re-derive that frame's message key, so whoever holds the messaging key later can open frames they kept; there is no ratchet. And every message carries a signature, so a recipient can prove to a third party who wrote it. See the design note in `src/messaging/envelope.ts` and the README limitations.
- **Key transparency.** A contact is a string you pasted (or a QR you scanned). Two fingerprints are shown so humans can compare them out of band; nothing else verifies that the key belongs to the person named next to it. Paste an attacker's identity and you are talking to the attacker.
- **Physical coercion, legal compulsion, and the recovery phrase in your notes app.** The phrase is the whole vault, twice over: it derives both the wallet and the chat key.
- **Anything on chain.** A broadcast Sepolia transaction is public and irreversible. Mainnet is refused by code, not by cryptography.
- **Quantum computing.** secp256k1 (ECDH and ECDSA-style signatures) and AES-family primitives are not post-quantum. This is a prototype on a testnet.

## 5. Messaging: the metadata story in detail

| What an observer sees | Detail                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Topic                 | `/oblivion/1/<32-hex>/proto` — one topic per pair of keys, stable for the life of the pair                                     |
| Payload               | Opaque `om1.<base64url JSON>`; the body is an `oc1` AEAD envelope whose key nobody on the wire holds                           |
| Timing and volume     | Every message and its arrival time; a relay that watches one topic can group a conversation                                    |
| Size                  | Ciphertext length ≈ plaintext length (no padding)                                                                              |
| Source IP             | The light node's own connection to its bootstrap and relay peers                                                               |
| Sender identity       | Nothing directly; the header carries a secp256k1 public key, which is not a wallet address and not linkable to one by this app |

The topic shape is a **documented deviation from the PRD** (which asked for `/oblivion/1/dm/<id>/proto`): Waku's own autosharding validator rejects the extra segment, so the conversation id _is_ the name field. The deviation is explained in `src/messaging/identity.ts`, asserted in `src/messaging/waku.test.ts`, and repeated in the README. It changes nothing about the confidentiality of the payload.

The second deviation is an absence: **the Store protocol is not wired up.** Only LightPush (send) and Filter (receive) are, so a message sent while the app was closed is lost and cannot be backfilled — history is what your own vault holds, on one device.

## 6. The wallet: what a third party learns

Every balance read, fee estimate, history scan and broadcast goes to whatever endpoint is configured (`VITE_SEPOLIA_RPC_URL`, otherwise the public `https://ethereum-sepolia-rpc.publicnode.com`). That provider sees your IP address, your wallet address and the timing of every request — and the chain itself sees every transaction forever. There is no indexer and no API key, so there is also no third party aggregating your history: recent activity is a bounded scan of the last 12 blocks (`DEFAULT_HISTORY_LOOKBACK_BLOCKS`), which is a privacy choice and a completeness cost at the same time.

The wallet does not and cannot hide amounts, addresses or timing once a transaction is broadcast. It refuses mainnet, it never touches real funds, and it holds no key at rest, but it is not a mixer.

## 7. Pay-in-chat: what a request proves, and what it does not

- **The request is authentic, not necessarily sane.** The signature proves which contact sent the bytes. It does not prove that `payTo` belongs to that contact — the identity key and the wallet address are deliberately unrelated (different BIP-44 branches), so a request is an assertion by a contact, and the payee address shown in the card is the thing to read and verify out of band before paying. A compromised contact, or a contact who simply wants to be paid to another address, can ask for any address.
- **The amount is exact and the fee is shown first.** The wallet signs a transaction for exactly `amountWei` to exactly `payTo`, after the worst-case fee is on screen and the balance has been checked against amount + fee.
- **The receipt is a claim until the chain says otherwise.** A `paid` receipt must carry a 32-byte transaction hash, and the thread links it to `sepolia.etherscan.io`. The chat does not query the chain for it: a lying payer could post a hash for a transaction that never happened, and the other side would only find out at the link. The payer's own wallet did sign and broadcast a real hash in the honest path, and that wallet's receipt read is the confirmation.
- **The ledger is local and can be partial.** A request that arrives is recorded with `from: null` because a request carries the requester's address, not the payer's, and the receipt carries a hash rather than an address. Two vaults can therefore disagree: the requester's row and the payer's row describe the same payment from different sides, and nothing reconciles them.
- **No expiry, no refund, no cancellation after sending.** A stale request stays payable forever; a request that was paid can only be addressed by another request in the other direction.
- **The note is private but not free.** Up to 200 characters, inside the envelope like the rest of the body — it is as private as the chat and no more.

## 8. Dependencies and supply chain

Direct dependencies and what they are trusted for:

| Package                        | Version | Used for                                                          |
| ------------------------------ | ------- | ----------------------------------------------------------------- |
| `libsodium-wrappers-sumo`      | ^0.8.4  | Argon2id (`crypto_pwhash`) and XChaCha20-Poly1305                 |
| `@noble/curves`                | ^2.4.0  | secp256k1 ECDH and compact signatures (RFC 6979 nonces)           |
| `@noble/hashes`                | ^2.4.0  | SHA-256 and HKDF                                                  |
| `@scure/bip39`, `@scure/bip32` | ^2.4.0  | Mnemonic and HD derivation                                        |
| `@waku/sdk`                    | ^0.0.36 | The Waku light node (lazily imported; tests and CI never load it) |
| `viem`                         | ^2.56.9 | Ethereum JSON-RPC, transaction signing and encoding               |
| `idb`                          | ^8.0.3  | The one IndexedDB record                                          |
| `qrcode`                       | ^1.5.4  | QR matrices (drawn by `src/ui/qr.ts`, no canvas)                  |
| `react`, `react-dom`           | ^19.3.0 | The UI                                                            |

No cryptography is hand-rolled: every primitive above comes from those libraries, and the app only composes them (AEAD envelope, HKDF step, header/AAD, signature). The lockfile is committed and CI installs with `npm ci`.

**Negative result, reported rather than buried:** `@waku/sdk@0.0.36` is the one dependency with known advisories — 6 vulnerabilities (2 moderate, 4 high) through `@waku/discovery`, `libp2p` and `uuid < 11.1.1`. `npm audit` reports them in CI, where the step is deliberately non-blocking; `npm audit fix --force` "resolves" them only by downgrading to `@waku/sdk@0.0.16`, a breaking downgrade of the transport the chat runs on. That trade is the maintainer's to make, so the finding stays visible in the README Results table instead of being silenced.

Other supply-chain properties: no secrets in the repository and `.env.example` documents the two optional variables; `gitleaks` runs in CI on every push and pull request as the `secret scan` job, which installs the pinned 8.24.3 release and scans the whole history (the `gitleaks-action@v2` this job used first could not scan a repository's first push at all — it derives a range that includes the root commit's non-existent parent — and it still targeted the Node 20 runtime GitHub is retiring); `.gitleaks.toml` allowlists four named test-vector values by value rather than allowlisting the files they live in, so a real credential pasted into `src/crypto/vectors.ts` or `src/wallet/format.test.ts` still fails the scan; the same binary was run by hand on the development machine (15 commits, no leaks, with a control secret still detected) but no npm script or hook automates that, so it is not part of `npm run verify`; GitHub Actions are otherwise referenced by mutable major tags (`actions/checkout@v4`, `actions/upload-artifact@v4`) rather than pinned commit SHAs, which is a known supply-chain weakness, and both actions make CI print GitHub's Node 20 deprecation warning on every run; there is no service worker, no runtime CDN fetch and no telemetry, analytics or logging of key material (`no-console` is an ESLint **error** in `src/`).

## 9. Known gaps, in one list

1. No audit, no security review, no formal verification, no bug bounty — this document is the builders' account.
2. No response-header hardening: no `frame-ancestors` (clicks can be framed), no HSTS, no `X-Content-Type-Options` — GitHub Pages cannot set headers, and the shipped `<meta>` policy covers what a meta policy can.
3. The decrypted vault document, including the mnemonic, is a JavaScript value that cannot be wiped from memory.
4. No forward secrecy, no ratchet, no deniability; a later compromise of a chat key opens kept frames and proves authorship.
5. No replay or freshness bound on `sentAt`; dedupe is local to one vault.
6. No message padding: length and timing leak what a relay can measure.
7. Light-node peers (default bootstrap) see the IP and the subscribed topics; no Tor/mixnet.
8. No Store history: messages sent while offline are gone.
9. A contact is a pasted key with a human-compared fingerprint; no key transparency.
10. A request's `payTo` is not bound to the contact's identity — verify the address out of band.
11. A `paid` receipt is an unverified claim until the explorer (or the payer's own chain read) confirms it.
12. Payment ledger rows can stay `from: null`, and the two sides of a payment are never reconciled.
13. No expiry, refund or cancellation for a payment request.
14. The RPC provider sees the wallet address and IP; no own-node guidance in-app, no private broadcast.
15. Bounded history (last 12 blocks) with no indexer.
16. Dependency risk above (the `@waku/sdk` advisories), and actions pinned by mutable tags.
17. `gitleaks` runs in CI on every push; the same pinned binary can be run by hand (it was, once, before the first push) but no npm script or pre-push hook automates it, so a local scan is not part of `npm run verify`.
18. Unaudited WebAssembly and JavaScript cryptography in a browser tab: the platform's own attack surface (browser, OS, extensions) is out of scope and unaddressed.

## 10. How these claims are checked

Every claim above that can be tested is, in the same repository, on every push:

| Area            | Tests                             | What they pin                                                                                                                                                                          |
| --------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crypto core     | 175 (`src/crypto`)                | Argon2id profiles and the weak-profile refusal, AEAD tamper detection on ciphertext/tag/nonce/AAD/envelope bytes, BIP-39/BIP-32/BIP-44 vectors, signature verification                 |
| Vault           | 140 (`src/vault`)                 | Create/unlock/lock/re-wrap, parameter-downgrade refusal, schema migration, auto-lock, and the plaintext-at-rest scan                                                                   |
| Wallet          | 88 (`src/wallet`)                 | Mainnet refusal with no request made, EIP-681 parsing, fee arithmetic, balance check, history bounds                                                                                   |
| Messaging       | 98 + 2 live (`src/messaging`)     | Envelope seal/open/tamper/signature, identity and topic shape, contact parsing, payment codec, mainnet-payment refusal with nothing published, and the Waku adapter against a fake SDK |
| UI              | 88 (`src/App.test.tsx`, `src/ui`) | The safety banner, the lock behaviour, wallet state tagging, the chat loops and the pay-in-chat loop (in-memory network + fake chain)                                                  |
| Security policy | 8 (`src/security/`)               | Each directive of the shipped Content-Security-Policy, including the ones deliberately absent (`'unsafe-inline'` for scripts, `frame-ancestors`)                                       |
| End-to-end      | 3 (`e2e/`)                        | The built app loads with the safety banner and the policy in its HTML; a real browser creates a vault and drives the wallet against a stubbed Sepolia endpoint                         |

Commands, timings and the full local verification log (including the two-browser live Waku check) are in [`PLAN.md`](PLAN.md). The live Waku tests are opt-in (`WAKU_LIVE=1`) so CI stays hermetic, and the `npm audit` finding is _reported_, never hidden.

## 11. Reporting a problem

This is a prototype with no security team, no contact address and no bounty. If you find a flaw, open an issue on the repository describing the problem class and the affected component — **without** pasting anyone's mnemonic, password, private key or vault record. If the finding needs to be private, say so in the issue and ask for a channel; do not assume one exists.

## 12. Revision history

- **2026-09-26** — first version (milestone 7), covering milestones 1–6.
- **2026-09-26, later the same day (milestone 8)** — the build now ships the Content-Security-Policy described in §4, so the gap that read "no CSP" is narrowed to the header-level items GitHub Pages cannot set (`frame-ancestors`, HSTS). The README's numbers are now generated by `npm run report` and recorded in `docs/report.json`; the demo recording is still outstanding.
