# The milestone-8 recording

Two browsers, two vaults, one real network — recorded against the built app by
[`scripts/demo.mjs`](../../scripts/demo.mjs), which walks the shot list in
[`../DEMO.md`](../DEMO.md) and keeps the lab notebook next to the pictures.

| File                               | What it is                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `alice.webm`                       | Alice's screen, `http://127.0.0.1:4183` (54.7 s)                                                   |
| `bob.webm`                         | Bob's screen, `http://127.0.0.1:4184` (55.4 s) — a different origin, a second vault                |
| `poster.png`                       | The README's above-the-fold image: a frame of Alice's screen, cropped by hand                      |
| `alice-identity.png`               | Alice's identity card: chat key, wallet address, and the fingerprints read aloud                   |
| `bob-identity.png`                 | Bob's, from the other origin — a different key, on purpose                                         |
| `alice-thread.png`                 | Alice's thread with both sealed messages on screen                                                 |
| `bob-refusals.png`                 | A wallet address in the contacts field, refused before anything is added                           |
| `bob-payment.png`                  | The payment request as the payer sees it: payee, status, and the one line saying why it cannot pay |
| `alice-declined.png`               | The decline, posted back into the requesting thread                                                |
| `alice-at-rest.png`                | The raw IndexedDB record, with the script's plaintext search beside it                             |
| `bob-locked.png`                   | Bob's vault after `Lock now`: no thread, no wallet, no signing key                                 |
| `stub/alice.webm`, `stub/bob.webm` | The same walk with the Sepolia endpoint replaced — see below                                       |
| `stub/alice-paid.png`              | The receipt card, hash and all, as it arrived in the requester's thread                            |
| `stub/bob-payment.png`             | The fee line before the button is armed, against the stubbed endpoint                              |
| `facts.json`, `stub/facts.json`    | The run's own record: identities, topic, refusals, the at-rest search, timings                     |

Every frame carries a badge naming the tab, the origin and **which chain is
behind it** (`live Sepolia RPC` or `STUB (Sepolia faked)`), and a caption bar the
recorder writes as it goes. The badge and the panel in `alice-at-rest.png` are
injected by the recording script and say so on screen; nothing else on these
pages is staged.

The `.webm` pair and `facts.json` are from one run (the identities in the videos
are the ones in `facts.json`). `poster.png` was cropped by hand from an **earlier**
run of the same script — it is the same app and the same moment, but the
addresses in it differ from the pair beside it.

## What the recording does and does not show

- **Real:** the built app, two origins with two encrypted vaults, Argon2id and
  XChaCha20-Poly1305, the public Waku network (LightPush to send, Filter to
  receive), the contact exchange and its refusals, sealed messages in both
  directions, the IndexedDB record read back and searched for plaintext, the
  lock/unlock cycle, and the payment request and decline round trip.
- **Not shown, because the key does not exist here:** a Sepolia transaction from
  a funded wallet. The repo holds no funded key, the build agent had no faucet,
  so on `--chain=live` the payer's wallet is empty: `eth_estimateGas` refuses
  with `EVM error: OutOfFunds` underneath, the card says so in one sentence —
  _\"This wallet does not hold enough Sepolia ETH to cover the amount plus the fee.
  Send testnet ETH to the address above and try again.\"_ — and `Pay` stays
  disabled, so the recording shows the decline path instead. That is the honest
  version of \"one click and the money moves\" on this machine. The sentence is
  the wallet's error path condensing the provider's reply; viem's raw multi-line
  dump is what goes to the browser console, not into a card.
- **`stub/` is the paying click under a fake chain, and is labelled as such.**
  `--chain=stub` answers the public RPC URL with the same canned JSON-RPC
  responder `e2e/wallet.spec.ts` uses (`e2e/stub-chain.json`): viem, the chain
  guard, the fee arithmetic, the signing, the sealing and the Waku round trip are
  all real, and only the chain is canned. In that run the fee line reads
  _\"Worst-case fee 0.00084 ETH (21000 gas at up to 40 gwei), so 0.00184 ETH has
  to be available\"_, the transaction is signed and \"broadcast\", and the hash came
  back through the sealed thread in **1.4 s**.
- **To record the real thing**, fund the payer and re-run:

  ```bash
  npm run demo:prepare   # creates two throwaway vaults (fresh ones) and prints the addresses
  #   send ~0.01 Sepolia ETH to the printed Bob address
  npm run demo:keep      # records the same two vaults, this time against the real endpoint
  ```

  The vaults live in a throwaway browser profile under
  `node_modules/.cache/oblivion-demo`, never in the repo, and they are created
  _before_ recording starts so the recovery-phrase screen is never on camera.

## How these files were made

```bash
npm run demo        # build, then record both screens against the public endpoint
npm run demo:stub   # build, then record both screens against the canned one
```

Playwright records one video per page, so there are two files per run rather
than one: they are the same wall-clock minutes, one per browser, which is the
point of a two-party demo. Nothing on screen was cut, reordered or otherwise
edited; the frames are in the order the script produced them.

The script also does the encoding, so the committed `.webm` files are not the
raw recordings but those raw recordings re-encoded in place with the ffmpeg
build Playwright itself ships (`-c:v libvpx -b:v 350k -r 15 -an`): 1280×800 VP8,
15 fps, ~150–175 kb/s, no audio — around 1 MB a minute instead of 3. It prints
what it did (`re-encoded alice.webm (3.2 MB → 1.1 MB, VP8, 15 fps)`), and on a
machine where that binary is missing it keeps the raw file and says so.
