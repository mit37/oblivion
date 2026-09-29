#!/usr/bin/env node
/**
 * Records the milestone-8 demo (the shot list in `docs/DEMO.md`) without a human
 * in the loop: two vaults on two origins, sealed chat in both directions over
 * the real Waku network, a pay-in-chat request, its decline and the refusals.
 *
 * Two design choices are what make the recording honest rather than pretty:
 *
 * - **The vaults live in a throwaway persistent profile** under
 *   `node_modules/.cache/oblivion-demo`, and they are created *before* recording
 *   starts, so the recovery-phrase screen is never on camera and every re-run
 *   uses the same two identities. That is also what makes the funded shot
 *   possible later: fund the payer's address once, re-run, and the same script
 *   records the real payment.
 * - **Nothing on screen is staged.** The chain is either the public Sepolia
 *   endpoint or a canned JSON-RPC responder — and every frame carries a badge
 *   that says which. There is no third option, and the captions are the words
 *   the demo is prepared to defend.
 *
 * Usage:
 *   npm run demo            # build, then record against the public Sepolia endpoint
 *   npm run demo:stub        # record with the Sepolia endpoint replaced
 *   npm run demo:prepare     # create two vaults, print the addresses, stop
 *   npm run demo:keep        # record with the vaults already in the profile
 *
 * The one shot this script cannot take by itself is a *funded* payment: the repo
 * holds no funded key. `demo:prepare` prints the payer's address; fund it, then
 * `demo:keep` records the same vaults paying for real.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'oblivion-demo')
const PROFILE = path.join(CACHE, 'profile')
const VIDEO_TMP = path.join(CACHE, 'video')
const VIEWPORT = { width: 1280, height: 800 }

/**
 * Playwright's raw recordings are around 3 MB a minute, at 25 fps, and the
 * committed pair is re-encoded to VP8 at 15 fps so the repository stays light.
 * That step used to be done by hand with the ffmpeg build Playwright itself
 * ships — which is a hole in a script whose whole point is that the recording is
 * reproducible. It happens here now, and a machine without the binary keeps the
 * raw file and says so rather than silently committing 3 MB.
 */
const REENCODE_ARGS = ['-c:v', 'libvpx', '-b:v', '350k', '-r', '15', '-an']

/** Throwaway, and it protects nothing: the demo vaults hold no funds. */
const PASSWORD = 'demo-vault-passphrase-2026'

const WAKU_TIMEOUT_MS = 120_000
const PAUSE_MS = 1200

const STARTED_AT = Date.now()

const log = (...parts) =>
  process.stdout.write(`[+${Math.round((Date.now() - STARTED_AT) / 1000)}s] ${parts.join(' ')}\n`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── arguments ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    port: 4183,
    chain: 'live',
    out: path.join('docs', 'demo'),
    keepProfile: false,
    prepareOnly: false,
    balanceEth: '1',
  }

  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=')

    if (name === 'keep-profile') options.keepProfile = true
    else if (name === 'prepare-only') options.prepareOnly = true
    else if (name === 'port') options.port = Number(value)
    else if (name === 'chain') options.chain = value
    else if (name === 'out') options.out = value
    else if (name === 'balance') options.balanceEth = value
    else throw new Error(`unknown argument --${name}`)
  }

  if (options.chain !== 'live' && options.chain !== 'stub') {
    throw new Error('--chain must be live or stub')
  }

  if (!Number.isInteger(options.port) || options.port < 1024) {
    throw new Error('--port must be an integer above 1023')
  }

  return options
}

// ─── the two origins ──────────────────────────────────────────────────────────

/**
 * Two origins are the point: the vault lives in IndexedDB, which is per-origin,
 * so two ports are two vaults. (Two host names would do as well; two ports need
 * no name resolution to behave.)
 */
function originsFor(port) {
  return {
    alice: `http://127.0.0.1:${port}/`,
    bob: `http://127.0.0.1:${port + 1}/`,
  }
}

async function startPreview(port) {
  const child = spawn(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--port',
      String(port),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
  })

  const url = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return child
    } catch {
      // not up yet
    }

    await sleep(300)
  }

  child.kill()
  throw new Error(`${url} never answered: ${output.trim()}`)
}

// ─── the browser HUD ──────────────────────────────────────────────────────────

/**
 * The recording is self-describing: a badge naming the tab and the chain, a
 * caption bar the script writes to, and a panel for showing the vault record.
 * Injected into the page, so it is labelled as the script's, not the app's.
 */
const HUD = ({ label, origin, chain }) => {
  document.getElementById('oblivion-demo-hud')?.remove()

  const style = document.createElement('style')
  style.textContent = `
    #oblivion-demo-hud { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    #oblivion-demo-hud .badge { position: absolute; top: 8px; left: 8px; padding: 4px 8px;
      background: rgba(12, 12, 16, 0.86); color: #f5f5f7; font-size: 12px; border-radius: 6px;
      letter-spacing: 0.02em; }
    #oblivion-demo-hud .badge b { color: #ffd166; }
    #oblivion-demo-hud .caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 14px;
      background: rgba(12, 12, 16, 0.9); color: #f5f5f7; font-size: 15px; line-height: 1.35;
      min-height: 42px; box-sizing: border-box; }
    #oblivion-demo-hud .panel { position: absolute; top: 56px; right: 12px; width: 46%;
      max-height: 74vh; overflow: auto; padding: 12px 14px; background: rgba(12, 12, 16, 0.94);
      color: #e8e8ea; font-size: 12px; line-height: 1.5; border-radius: 8px; border: 1px solid #444;
      white-space: pre-wrap; word-break: break-all; }
    #oblivion-demo-hud .panel h4 { margin: 0 0 8px; font-size: 12px; color: #ffd166; }
    #oblivion-demo-hud .panel .ok { color: #8ce99a; }
    #oblivion-demo-hud .panel .no { color: #ffa8a8; }
  `

  const hud = document.createElement('div')
  hud.id = 'oblivion-demo-hud'
  hud.innerHTML = `
    <div class="badge"><b>DEMO</b> ${label} · ${origin} · chain: ${chain}</div>
    <div class="caption" data-caption></div>
  `
  hud.append(style)
  document.body.append(hud)

  window.__demoCaption = (text) => {
    hud.querySelector('[data-caption]').textContent = text
  }

  window.__demoPanel = (heading, body) => {
    hud.querySelector('.panel')?.remove()
    const panel = document.createElement('div')
    panel.className = 'panel'
    panel.innerHTML = `<h4></h4><div data-body></div>`
    panel.querySelector('h4').textContent = heading
    panel.querySelector('[data-body]').innerHTML = body
    hud.append(panel)
  }

  window.__demoClosePanel = () => hud.querySelector('.panel')?.remove()
}

async function decorate(page, options) {
  await page.evaluate(HUD, options)
}

const setCaption = (pages, text) => {
  log(`[shot] ${text}`)

  return Promise.all(
    Object.values(pages).map((page) => page.evaluate((t) => window.__demoCaption?.(t), text)),
  )
}

const showPanel = (page, heading, body) =>
  page.evaluate(([h, b]) => window.__demoPanel?.(h, b), [heading, body])

const closePanel = (page) => page.evaluate(() => window.__demoClosePanel?.())

// ─── waiting ──────────────────────────────────────────────────────────────────

async function waitForHeading(page, name, timeout = 60_000) {
  try {
    await page.getByRole('heading', { name }).first().waitFor({ state: 'visible', timeout })
  } catch {
    throw new Error(`waited ${timeout} ms for the heading "${name}" and never saw it`)
  }
}

async function waitForTextSoft(page, selector, text, timeout) {
  try {
    await waitForText(page, selector, text, timeout)
    return true
  } catch {
    return false
  }
}

async function waitForText(page, selector, text, timeout = 60_000) {
  const deadline = Date.now() + timeout
  let last = ''

  while (Date.now() < deadline) {
    last =
      (await page
        .locator(selector)
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    if (last.includes(text)) return last
    await sleep(400)
  }

  throw new Error(
    `waited ${timeout} ms for "${text}" inside ${selector}; the element said ${JSON.stringify(last)}`,
  )
}

/** Waits for either of two body markers, answering which one showed up. */
async function waitForEither(page, selector, markers, timeout = 60_000) {
  const deadline = Date.now() + timeout
  let last = ''

  while (Date.now() < deadline) {
    last =
      (await page
        .locator(selector)
        .first()
        .textContent()
        .catch(() => '')) ?? ''
    const found = markers.find((marker) => last.includes(marker))
    if (found) return found
    await sleep(400)
  }

  return null
}

// ─── vault flows ──────────────────────────────────────────────────────────────

async function createVault(page) {
  await waitForHeading(page, 'Create your vault', 30_000)
  await page.getByLabel('New password').fill(PASSWORD)
  await page.getByLabel('Repeat password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create vault' }).click()

  await waitForHeading(page, 'Write down your recovery phrase', 180_000)
  const words = await page.locator('[data-testid="recovery-phrase"] .word-text').allTextContents()

  if (words.length !== 12) throw new Error(`expected a 12-word phrase, saw ${words.length}`)

  await page.getByRole('button', { name: 'I have written it down' }).click()
  await waitForHeading(page, 'Confirm three words', 30_000)

  const fields = page.locator('label').filter({ hasText: 'Word #' })

  for (let index = 0; index < (await fields.count()); index += 1) {
    const field = fields.nth(index)
    const label = (await field.locator('span').first().textContent())?.trim() ?? ''
    const position = Number(label.replace('Word #', ''))
    await field.locator('input').fill(words[position - 1] ?? '')
  }

  await page.getByRole('button', { name: 'Confirm and open my vault' }).click()
  await waitForHeading(page, 'Your identity', 120_000)
}

async function unlockVault(page, { slowly = false } = {}) {
  await waitForHeading(page, 'Unlock your vault', 30_000)

  const field = page.getByLabel('Password')
  await field.click()

  if (slowly) await field.pressSequentially(PASSWORD, { delay: 16 })
  else await field.fill(PASSWORD)

  await page.getByRole('button', { name: 'Unlock' }).click()
  await waitForHeading(page, 'Your identity', 120_000)
}

/** Which gate this profile is showing: a fresh vault or one to unlock. */
async function waitForGate(page, timeout = 60_000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    for (const name of ['Create your vault', 'Unlock your vault']) {
      if (await page.getByRole('heading', { name }).first().isVisible()) return name
    }

    await sleep(200)
  }

  throw new Error('the vault gate never appeared: the app did not finish loading')
}

async function readIdentity(page) {
  return {
    address: (await page.getByTestId('wallet-address').textContent())?.trim() ?? '',
    identity: (await page.getByTestId('messaging-identity').textContent())?.trim() ?? '',
    fingerprint: (await page.getByTestId('messaging-fingerprint').textContent())?.trim() ?? '',
  }
}

/** The sealed record as IndexedDB actually holds it — the same read the tests scan. */
const readVaultRecord = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open('oblivion-vault')

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const get = database.transaction('vault', 'readonly').objectStore('vault').get('primary')
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
    }
  })

// ─── the messaging flows ──────────────────────────────────────────────────────

const CONTACTS_SELECTOR = 'section[aria-labelledby="messaging-contacts-title"]'
const THREAD_SELECTOR = 'section[aria-labelledby="messaging-thread-title"]'

const contactsCard = (page) => page.locator(CONTACTS_SELECTOR)
const threadCard = (page) => page.locator(THREAD_SELECTOR)

/** Types an identity into the contacts form and answers the text it gave back. */
async function addContact(page, identity, label, { expectAdded = true } = {}) {
  const card = contactsCard(page)

  await card.getByLabel('Contact identity').fill(identity)
  await card.getByLabel('Name').fill(label)
  await card.getByRole('button', { name: 'Add contact' }).click()

  const message = await waitForNote(card, 20_000)

  if (expectAdded && !message.startsWith('Added')) {
    throw new Error(`adding ${label} did not add anything: ${JSON.stringify(message)}`)
  }

  return message
}

/** The contacts form answers in a note that only appears once it has an answer. */
async function waitForNote(card, timeout) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const note = card.locator('.form-note').first()
    if ((await note.count()) > 0) {
      const text = ((await note.textContent()) ?? '').trim()
      if (text.length > 0) return text
    }

    await sleep(200)
  }

  return ''
}

/**
 * Sends a message, retrying only what the network refused. A LightPush with no
 * peer behind it fails loudly in the thread's own error line, which is the one
 * failure this script is allowed to retry — the retry is written into the log.
 */
async function sendText(page, body, { attempts = 3 } = {}) {
  const card = threadCard(page)
  const marker = body.slice(0, 24)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const draft = card.getByLabel('Message')
    await draft.fill('')
    await draft.pressSequentially(body, { delay: 8 })
    await card.getByRole('button', { name: 'Send' }).click()

    const outcome = await waitForEither(
      page,
      'section[aria-labelledby="messaging-thread-title"]',
      [marker, 'no Waku peer accepted'],
      60_000,
    )

    if (outcome === marker) return
    if (outcome === null)
      throw new Error(`sending ${JSON.stringify(marker)} timed out with no answer`)
    log(`[chat] attempt ${attempt} refused by the network (no peer behind LightPush); retrying`)
  }

  throw new Error(`the network refused ${attempts} attempts to send ${JSON.stringify(marker)}`)
}

async function requestPayment(page, amount, note, { attempts = 2 } = {}) {
  const card = threadCard(page)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await card.getByTestId('payment-request-amount').fill(amount)
    await card.getByTestId('payment-request-note').fill(note)
    await card.getByTestId('payment-request-submit').click()

    const outcome = await waitForEither(
      page,
      'section[aria-labelledby="messaging-thread-title"]',
      [`for ${amount} ETH`, 'no Waku peer accepted'],
      60_000,
    )

    if (outcome !== null && outcome !== 'no Waku peer accepted') return
    log(`[pay] attempt ${attempt} refused by the network; retrying`)
  }

  throw new Error(`the request for ${amount} ETH never left this vault`)
}

// ─── the chain ────────────────────────────────────────────────────────────────

/** The canned responder the e2e wallet spec uses, so the demo and CI agree. */
async function installStubChain(context, { balanceEth, fixture }) {
  const balance = BigInt(Math.round(Number(balanceEth) * 1e18))
  const hex = (value) => `0x${BigInt(value).toString(16)}`
  const gwei = (value) => `0x${(BigInt(value) * 10n ** 9n).toString(16)}`
  const sentHash = `0x${'cd'.repeat(32)}`
  const state = { address: '', sent: [] }

  await context.route('**/ethereum-sepolia-rpc.publicnode.com/**', async (route) => {
    const call = route.request().postDataJSON()
    const result = respond(call)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: call.id ?? 1, result }),
    })
  })

  function respond(call) {
    switch (call.method) {
      case 'eth_chainId':
        return '0xaa36a7'
      case 'eth_blockNumber':
        return '0x64'
      case 'eth_getBalance':
        state.address = String(call.params[0])
        return hex(balance)
      case 'eth_estimateGas':
        return hex(fixture.gasLimit)
      case 'eth_gasPrice':
        return gwei(fixture.gasPriceGwei)
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00'
      case 'eth_getTransactionCount':
        return '0x0'
      case 'eth_fillTransaction': {
        const request = call.params[0] ?? {}
        return {
          ...request,
          chainId: '0xaa36a7',
          gas: hex(fixture.gasLimit),
          maxFeePerGas: gwei(fixture.maxFeePerGasGwei),
          maxPriorityFeePerGas: '0x3b9aca00',
          nonce: '0x0',
          type: '0x2',
          value: typeof request.value === 'string' ? request.value : '0x0',
        }
      }
      case 'eth_sendRawTransaction':
        state.sent.push(String(call.params[0]))
        return sentHash
      case 'eth_getTransactionReceipt':
        return String(call.params[0]) === sentHash ? receipt(sentHash) : null
      case 'eth_getTransactionByHash':
        return null
      case 'eth_getBlockByNumber':
        return block(Number.parseInt(String(call.params[0]), 16), state.address)
      default:
        throw new Error(`the demo's stub chain does not answer ${call.method}`)
    }
  }

  function receipt(hash) {
    return {
      transactionHash: hash,
      status: '0x1',
      blockNumber: '0x64',
      gasUsed: hex(fixture.gasLimit),
      cumulativeGasUsed: hex(fixture.gasLimit),
      logs: [],
      logsBloom: `0x${'00'.repeat(256)}`,
      transactionIndex: '0x0',
      blockHash: `0x${'11'.repeat(32)}`,
      contractAddress: null,
      effectiveGasPrice: gwei(fixture.gasPriceGwei),
      type: '0x2',
    }
  }

  function block(number, address) {
    const hash = `0x${'11'.repeat(32)}`

    return {
      number: `0x${number.toString(16)}`,
      hash,
      parentHash: `0x${'22'.repeat(32)}`,
      nonce: '0x0000000000000042',
      sha3Uncles: `0x${'33'.repeat(32)}`,
      logsBloom: `0x${'00'.repeat(256)}`,
      transactionsRoot: `0x${'44'.repeat(32)}`,
      stateRoot: `0x${'55'.repeat(32)}`,
      receiptsRoot: `0x${'66'.repeat(32)}`,
      miner: `0x${'77'.repeat(20)}`,
      difficulty: '0x0',
      totalDifficulty: '0x0',
      extraData: '0x',
      size: '0x200',
      gasLimit: '0x1c9c380',
      gasUsed: hex(fixture.gasLimit),
      baseFeePerGas: '0x3b9aca00',
      timestamp: '0x66f00000',
      uncles: [],
      transactions: [
        {
          hash: `0x${'ab'.repeat(32)}`,
          blockHash: hash,
          blockNumber: `0x${number.toString(16)}`,
          transactionIndex: '0x0',
          from: `0x${'88'.repeat(20)}`,
          to: address || null,
          value: '0x5af3107a4000',
          gas: hex(fixture.gasLimit),
          gasPrice: gwei(fixture.gasPriceGwei),
          maxFeePerGas: gwei(fixture.gasPriceGwei),
          maxPriorityFeePerGas: '0x3b9aca00',
          nonce: '0x1',
          input: '0x',
          type: '0x2',
          chainId: '0xaa36a7',
          v: '0x1',
          r: `0x${'99'.repeat(32)}`,
          s: `0x${'aa'.repeat(32)}`,
        },
      ],
    }
  }

  return state
}

// ─── setup: the two vaults, created before the camera is on ───────────────────

async function prepareVaults(origins) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: VIEWPORT,
  })
  const facts = {}

  try {
    for (const [name, url] of Object.entries(origins)) {
      const page = name === 'alice' ? context.pages()[0] : await context.newPage()
      await page.goto(url)

      if ((await waitForGate(page)) === 'Create your vault') {
        log(`[setup] ${name}: creating a vault (the recovery phrase stays off camera)`)
        await createVault(page)
      } else {
        log(`[setup] ${name}: reusing the vault this profile already holds`)
        await unlockVault(page)
      }

      await waitForHeading(page, 'Your identity', 120_000)
      facts[name] = await readIdentity(page)
    }
  } finally {
    await context.close()
  }

  return facts
}

// ─── the recording ────────────────────────────────────────────────────────────

async function record(options, origins, facts, outDir, holder) {
  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_TMP, size: VIEWPORT },
  })

  const pages = {
    alice: context.pages()[0],
    bob: await context.newPage(),
  }
  const videos = { alice: pages.alice.video(), bob: pages.bob.video() }
  const shots = {}
  const run = { startedAt: new Date().toISOString(), chain: options.chain, origins }

  // Handed back before anything can fail, so a failed run still keeps its video.
  holder.run = run
  holder.videos = videos

  try {
    if (options.chain === 'stub') {
      const fixture = JSON.parse(await readFile(path.join(ROOT, 'e2e', 'stub-chain.json'), 'utf8'))
      holder.stubChain = await installStubChain(context, {
        balanceEth: options.balanceEth,
        fixture,
      })
      log(`[chain] Sepolia endpoint replaced by the e2e stub chain (${options.balanceEth} ETH)`)
    }

    for (const [name, page] of Object.entries(pages)) {
      await page.goto(origins[name])
      await decorate(page, {
        label: name,
        origin: origins[name].replace(/\/$/, ''),
        chain: options.chain === 'stub' ? 'STUB (Sepolia faked)' : 'live Sepolia RPC',
      })
    }

    // ── Shot 1: two vaults, two identities ─────────────────────────────────
    await setCaption(
      pages,
      'Milestone 8 demo — two browsers, two vaults, one real network. Shot 1: unlock.',
    )
    await sleep(PAUSE_MS)

    await unlockVault(pages.alice, { slowly: true })
    await unlockVault(pages.bob, { slowly: true })

    await setCaption(
      pages,
      'One password derives everything: Argon2id → key → sealed vault. Nothing is sent anywhere to open it.',
    )
    await sleep(PAUSE_MS)

    await setCaption(
      pages,
      'Alice and Bob are two different keys: the wallet key and the chat key sit on different derivation paths.',
    )
    await pages.alice.getByRole('heading', { name: 'Your identity' }).scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS)
    await pages.alice.getByRole('heading', { name: 'Your chat identity' }).scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS)
    shots['alice-identity'] = await pages.alice.screenshot({
      path: path.join(outDir, 'alice-identity.png'),
    })

    await pages.bob.getByRole('heading', { name: 'Your identity' }).scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS)
    await pages.bob.getByRole('heading', { name: 'Your chat identity' }).scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS)
    shots['bob-identity'] = await pages.bob.screenshot({
      path: path.join(outDir, 'bob-identity.png'),
    })

    await setCaption(
      pages,
      'Fingerprints, read aloud when the identity is exchanged: ' +
        `${facts.alice.fingerprint} (Alice) and ${facts.bob.fingerprint} (Bob).`,
    )
    await sleep(PAUSE_MS + 800)

    // ── connect, and use the wait for the refusals ─────────────────────────
    await setCaption(
      pages,
      'Connecting both tabs to the real Waku network: LightPush to send, Filter to receive.',
    )
    await pages.bob.getByRole('button', { name: 'Connect to Waku' }).click()
    await pages.alice.getByRole('button', { name: 'Connect to Waku' }).click()

    await setCaption(
      pages,
      'While the nodes find peers — paste a wallet address into the contacts field. It is refused.',
    )
    const addressRefusal = await addContact(pages.bob, facts.alice.address, 'Alice (0x address)', {
      expectAdded: false,
    })
    run.addressRefusal = addressRefusal
    await sleep(PAUSE_MS)
    shots['bob-refusals'] = await pages.bob.screenshot({
      path: path.join(outDir, 'bob-refusals.png'),
    })

    await setCaption(pages, 'A contact identity is a chat key, never a wallet address.')
    const selfRefusal = await addContact(pages.alice, facts.alice.identity, 'Alice (myself)', {
      expectAdded: false,
    })
    run.selfRefusal = selfRefusal
    await sleep(PAUSE_MS)

    await waitForText(
      pages.alice,
      '[data-testid="connection-pill"]',
      'Waku network',
      WAKU_TIMEOUT_MS,
    )
    await waitForText(pages.bob, '[data-testid="connection-pill"]', 'Waku network', WAKU_TIMEOUT_MS)
    await setCaption(pages, 'Both tabs are on the network now — no server of ours is involved.')

    const aliceAdding = await addContact(pages.bob, facts.alice.identity, 'Alice')
    const bobAdding = await addContact(pages.alice, facts.bob.identity, 'Bob')
    run.added = { aliceAdding, bobAdding }

    await setCaption(
      pages,
      'The conversation id is computed from both keys, so either side gets the same topic unaided.',
    )
    run.topic = (await pages.alice.getByTestId('conversation-topic').textContent())?.trim()
    await sleep(PAUSE_MS + 600)

    // ── Shot 2: sealed chat both ways ──────────────────────────────────────
    await setCaption(
      pages,
      'Shot 2: Alice writes. On the wire the payload is om1.… — the relay sees traffic, never text.',
    )
    const aliceLine = 'Bob — this sentence only exists in our two vaults and the sealed frame.'
    await sendText(pages.alice, aliceLine)
    await waitForText(pages.bob, '[data-testid="message-list"]', aliceLine.slice(0, 24), 90_000)
    run.firstMessage = aliceLine
    await sleep(PAUSE_MS)

    await setCaption(
      pages,
      'Bob answers; the reply is sealed to Alice the same way, in the other direction.',
    )
    const bobLine =
      'Received, opened locally, and stored encrypted. Answering from the same thread.'
    await sendText(pages.bob, bobLine)
    await waitForText(pages.alice, '[data-testid="message-list"]', bobLine.slice(0, 24), 90_000)
    run.reply = bobLine
    await sleep(PAUSE_MS)
    shots['alice-thread'] = await pages.alice.screenshot({
      path: path.join(outDir, 'alice-thread.png'),
    })

    // ── what is on disk ────────────────────────────────────────────────────
    await setCaption(
      pages,
      'The same vault on disk (DevTools → IndexedDB) holds parameters, a salt and one oc1.… envelope.',
    )
    const record = await pages.alice.evaluate(readVaultRecord)
    const serialised = JSON.stringify(record)
    const needles = {
      'the demo password': PASSWORD,
      'the wallet address': facts.alice.address,
      'the chat identity': facts.alice.identity,
      'the message just sent': aliceLine.slice(0, 24),
    }
    const found = Object.entries(needles).map(([what, needle]) => ({
      what,
      present: serialised.includes(needle),
    }))
    run.record = {
      version: record?.version,
      keys: Object.keys(record ?? {}),
      envelopeLength: record?.envelope?.length ?? 0,
      plaintextSearch: found,
    }

    await showPanel(
      pages.alice,
      'IndexedDB → oblivion-vault → vault["primary"]  (read out by scripts/demo.mjs, not part of the app)',
      [
        escapeHtml(
          JSON.stringify(
            {
              recordVersion: record?.version,
              kdf: record?.kdf,
              envelope: `${String(record?.envelope ?? '').slice(0, 72)}… (${record?.envelope?.length ?? 0} chars)`,
            },
            null,
            2,
          ),
        ),
        '',
        ...found.map(
          (entry) =>
            `<span class="${entry.present ? 'no' : 'ok'}">${entry.present ? 'found' : 'not in the record'}</span> — ${escapeHtml(entry.what)}`,
        ),
        '',
        'The sealed document inside (schema v3: identity, contacts, messages, payments) is what the app reads; this record is all that is on disk.',
      ].join('\n'),
    )
    await sleep(PAUSE_MS + 1600)
    shots['alice-at-rest'] = await pages.alice.screenshot({
      path: path.join(outDir, 'alice-at-rest.png'),
    })
    await closePanel(pages.alice)

    // ── Shot 3: pay-in-chat ────────────────────────────────────────────────
    await setCaption(
      pages,
      'Shot 3: Alice asks Bob for 0.001 ETH. The request travels sealed like any other message.',
    )
    const note = 'demo request'
    await requestPayment(pages.alice, '0.001', note)

    // Picked by its own note rather than by position: a re-run of the demo
    // against a profile that already holds a thread still finds this one card.
    const requestCard = pages.bob.getByTestId('payment-card').filter({ hasText: note }).last()
    await requestCard.waitFor({ state: 'visible', timeout: 90_000 })
    await sleep(PAUSE_MS)

    await requestCard.scrollIntoViewIfNeeded()
    await setCaption(
      pages,
      'Bob checks the payee address and the fee before anything can be signed: ' +
        (await requestCard.getByTestId('payment-payto').textContent())?.trim(),
    )
    await sleep(PAUSE_MS + 1200)

    const payDisabled = await requestCard.getByTestId('payment-pay').isDisabled()
    const feeLine = (await requestCard.getByTestId('payment-fee').textContent())?.trim() ?? ''
    const shortfall = (await requestCard.getByTestId('payment-shortfall').count()) > 0
    const cardError =
      (await requestCard.getByTestId('payment-error').count()) > 0
        ? ((await requestCard.getByTestId('payment-error').textContent()) ?? '').trim()
        : null
    run.payment = { feeLine, payDisabled, shortfall, cardError }
    log(`[pay] pay disabled: ${payDisabled} · fee line: ${feeLine || '(none)'}`)
    if (cardError) log(`[pay] the chain said: ${cardError}`)

    await setCaption(
      pages,
      options.chain === 'stub'
        ? 'FEE BEFORE THE BUTTON: Pay arms only after the fee is known, and the endpoint is STUBBED here.'
        : 'FEE BEFORE THE BUTTON: Pay arms only once the fee is known — and this payer wallet is unfunded.',
    )
    await sleep(PAUSE_MS + 1200)
    shots['bob-payment'] = await pages.bob.screenshot({
      path: path.join(outDir, 'bob-payment.png'),
    })

    if (await requestCard.getByTestId('payment-pay').isEnabled()) {
      const paidAt = Date.now()
      await setCaption(
        pages,
        options.chain === 'stub'
          ? 'Paying against the STUBBED endpoint: real signing, real sealing, a canned chain.'
          : 'Paying on Sepolia.',
      )
      await requestCard.getByTestId('payment-pay').click()
      await waitForText(pages.alice, '[data-testid="payment-receipt-hash"]', '0x', 90_000)
      const hash = (
        await pages.alice.getByTestId('payment-receipt-hash').last().textContent()
      )?.trim()
      run.payment.hash = hash
      run.payment.hashInThreadMs = Date.now() - paidAt
      await setCaption(
        pages,
        `The hash came back through the sealed thread, both ways, in ${(
          (Date.now() - paidAt) /
          1000
        ).toFixed(1)} s: ${hash}`,
      )
      await sleep(PAUSE_MS + 1600)
      shots['alice-paid'] = await pages.alice.screenshot({
        path: path.join(outDir, 'alice-paid.png'),
      })
    }

    // ── a second request, declined: the path that never touches the chain ───
    await setCaption(
      pages,
      'A second request, declined — the path that never calls the chain at all.',
    )

    const declineNote = 'decline path'
    await requestPayment(pages.alice, '0.0005', declineNote)

    const declineCard = pages.bob
      .getByTestId('payment-card')
      .filter({ hasText: declineNote })
      .last()
    await declineCard.waitFor({ state: 'visible', timeout: 90_000 })
    await declineCard.scrollIntoViewIfNeeded()

    let declined = false
    let declineAttempts = 0

    while (!declined && declineAttempts < 3) {
      declineAttempts += 1
      await declineCard.getByTestId('payment-decline').click()
      declined = await waitForTextSoft(pages.alice, THREAD_SELECTOR, 'Declined.', 30_000)

      if (!declined)
        log(`[pay] the decline did not reach Alice on attempt ${declineAttempts}; retrying`)
    }

    if (!declined) throw new Error('the decline receipt never reached the requester')

    run.decline = {
      attempts: declineAttempts,
      bobCard: ((await declineCard.textContent()) ?? '').trim(),
    }
    await setCaption(
      pages,
      'Declined: a receipt, sealed and published like any other message. No transaction was ever built.',
    )
    await pages.alice.getByTestId('payment-card').last().scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS + 1200)
    shots['alice-declined'] = await pages.alice.screenshot({
      path: path.join(outDir, 'alice-declined.png'),
    })

    // ── Shot 4: the refusals, and the lock ─────────────────────────────────
    await setCaption(
      pages,
      'Shot 4: the identity card names chain ID 11155111. Mainnet is a non-goal and the code refuses it.',
    )
    await pages.alice.getByRole('heading', { name: 'Your identity' }).scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS + 1000)

    await setCaption(
      pages,
      'Lock now: the wallet, the thread and the signing key leave memory. A reload always starts locked.',
    )
    await pages.alice.getByRole('button', { name: 'Lock now' }).click()
    await pages.bob.getByRole('button', { name: 'Lock now' }).click()
    await waitForHeading(pages.alice, 'Unlock your vault', 30_000)
    await waitForHeading(pages.bob, 'Unlock your vault', 30_000)
    await sleep(PAUSE_MS)
    shots['bob-locked'] = await pages.bob.screenshot({ path: path.join(outDir, 'bob-locked.png') })

    await setCaption(
      pages,
      'Unlock again: the contacts, the thread and the keys come back from the same vault.',
    )
    await unlockVault(pages.alice, { slowly: true })
    await unlockVault(pages.bob, { slowly: true })
    await pages.alice
      .getByRole('heading', { name: 'Conversation with Bob' })
      .scrollIntoViewIfNeeded()
    await sleep(PAUSE_MS + 800)

    await setCaption(
      pages,
      'That is the build: two origins, two vaults, sealed chat over the real Waku network' +
        (options.chain === 'stub'
          ? ' — chain stubbed in this recording.'
          : ' — and an unfunded payer.'),
    )
    await sleep(3000)
  } finally {
    await context.close()
  }

  return { videos, shots }
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('nothing to record: run `npm run build` first')
  }

  // Every recording starts from two fresh vaults unless asked otherwise: the
  // threads have to be empty for the captions to be about this run. `demo:keep`
  // is the exception, and exists for the one flow that needs the same identity
  // twice — prepare, fund the payer, then record.
  if (!options.keepProfile) {
    await rm(CACHE, { recursive: true, force: true })
    log('[setup] clean demo profile: two fresh vaults, two empty threads')
  }

  await mkdir(CACHE, { recursive: true })
  await mkdir(VIDEO_TMP, { recursive: true })

  const outDir = path.join(ROOT, options.out)
  await mkdir(outDir, { recursive: true })

  const origins = originsFor(options.port)

  // Two origins are two servers here: the app itself is the same build on both.
  const servers = await Promise.all([startPreview(options.port), startPreview(options.port + 1)])
  log(`[server] preview servers up on ${options.port} and ${options.port + 1}`)

  const holder = {}
  let failure = null

  try {
    const facts = await prepareVaults(origins)

    log(`[setup] Alice    ${origins.alice}  ${facts.alice.address}  ${facts.alice.identity}`)
    log(`[setup] Bob      ${origins.bob}  ${facts.bob.address}  ${facts.bob.identity}`)
    log('[setup] for a real payment: fund Bob, then `npm run demo:keep` on this same profile')

    if (options.prepareOnly) return

    const outcome = await record(options, origins, facts, outDir, holder)
    const saved = await writeVideoFiles(outcome.videos, outDir, { reencode: true })

    const factsFile = {
      recordedAt: holder.run.startedAt,
      chain: options.chain,
      origins,
      identities: facts,
      topic: holder.run.topic,
      messages: { alice: holder.run.firstMessage, bob: holder.run.reply },
      refusals: {
        walletAddress: holder.run.addressRefusal,
        selfContact: holder.run.selfRefusal,
      },
      recordAtRest: holder.run.record,
      payment: holder.run.payment,
      declinedRequest: holder.run.decline,
      stubChain: holder.stubChain
        ? { balanceEth: options.balanceEth, transactionsBroadcast: holder.stubChain.sent.length }
        : null,
      video: saved,
    }

    const factsPath = path.join(outDir, 'facts.json')
    await writeFile(factsPath, `${JSON.stringify(factsFile, null, 2)}\n`)
    formatJson(factsPath)

    log(`[demo] recorded ${JSON.stringify(saved)}`)
    log(`[demo] facts written to ${path.join(options.out, 'facts.json')}`)
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause)
    log(`[demo] FAILED: ${failure}`)
    log('[demo] the recording up to the failure is kept for the write-up')

    const saved = await writeVideoFiles(holder.videos ?? {}, path.join(CACHE, 'failed'), {
      prefix: 'failed-',
    })
    await writeFile(
      path.join(CACHE, 'failure.json'),
      `${JSON.stringify({ at: new Date().toISOString(), chain: options.chain, message: failure, saved }, null, 2)}\n`,
    )
  } finally {
    for (const server of servers) server.kill()
  }

  process.exitCode = failure ? 1 : 0
}

async function writeVideoFiles(videos, directory, { prefix = '', reencode = false } = {}) {
  await mkdir(directory, { recursive: true })
  const saved = {}

  for (const [name, video] of Object.entries(videos)) {
    const source = await video?.path().catch(() => null)
    if (!source) continue

    const target = path.join(directory, `${prefix}${name}.webm`)
    await copyFile(source, target)
    if (reencode) await reencodeVideo(target)
    saved[name] = path.relative(ROOT, target).split(path.sep).join('/')
  }

  return saved
}

/** Re-encodes one recording in place, or leaves it raw and says why. */
async function reencodeVideo(target) {
  const name = path.basename(target)
  const ffmpeg = findPlaywrightFfmpeg()

  if (!ffmpeg) {
    log(`[demo] no Playwright ffmpeg on this machine: ${name} stays as recorded`)
    return
  }

  const before = (await stat(target)).size
  // The temporary file keeps the extension: ffmpeg picks its muxer from it.
  const temporary = target.replace(/\.webm$/, '.encoded.webm')
  const result = spawnSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      target,
      ...REENCODE_ARGS,
      '-f',
      'webm',
      temporary,
    ],
    { stdio: 'inherit' },
  )

  if (result.status !== 0 || !existsSync(temporary)) {
    await rm(temporary, { force: true })
    log(`[demo] ffmpeg could not re-encode ${name}: it stays as recorded`)
    return
  }

  await rename(temporary, target)

  const after = (await stat(target)).size
  log(`[demo] re-encoded ${name} (${megabytes(before)} → ${megabytes(after)}, VP8, 15 fps)`)
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * `facts.json` is committed and therefore covered by `npm run format:check`, so
 * the script that writes it formats it the way the repository does instead of
 * leaving a file the next `prettier --write` would touch. Same shell trick as
 * `scripts/report.mjs`: Windows needs a shell for `npx.cmd`.
 */
function formatJson(file) {
  const relative = path.relative(ROOT, file).split(path.sep).join('/')
  const command = ['npx', 'prettier', '--write', relative]
  const quote = (value) => (/\s/.test(value) ? `"${value}"` : value)
  const result =
    process.platform === 'win32'
      ? spawnSync(command.map(quote).join(' '), { cwd: ROOT, shell: true, stdio: 'inherit' })
      : spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: 'inherit' })

  if (result.status !== 0) log(`[demo] could not format ${path.basename(file)} with prettier`)
}

/**
 * Playwright downloads its own ffmpeg next to the browsers when video recording
 * is enabled — under `ms-playwright/ffmpeg-<build>/` in the platform cache
 * directory. It is found rather than configured: the demo already depends on it
 * having been downloaded, because that is what recorded the video in the first
 * place.
 */
function findPlaywrightFfmpeg() {
  const cache = path.join(homedir(), '.cache', 'ms-playwright')
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright')
      : undefined,
    process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Caches', 'ms-playwright')
      : (process.env.XDG_CACHE_HOME && path.join(process.env.XDG_CACHE_HOME, 'ms-playwright')) ||
        cache,
  ].filter(Boolean)

  for (const root of roots) {
    if (!existsSync(root)) continue

    for (const entry of readdirSync(root)) {
      if (!entry.startsWith('ffmpeg')) continue

      const directory = path.join(root, entry)
      const binary = readdirSync(directory).find((file) => file.startsWith('ffmpeg'))

      if (binary) return path.join(directory, binary)
    }
  }

  return null
}

try {
  await main()
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause)
  process.stdout.write(`[demo] ${message}\n`)
  process.exitCode = 1
}
