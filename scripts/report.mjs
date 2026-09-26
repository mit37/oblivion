#!/usr/bin/env node
/**
 * Regenerates the README Results table from measurements taken in this repo,
 * and records the raw output it parsed in `docs/report.json`.
 *
 * STANDARDS.md §1.3: every README number is produced by a script in the repo.
 * A measurement this machine cannot take — the opt-in live Waku timings, for
 * example — becomes a `not measured` row with the reason, never a guess.
 *
 * Usage:
 *   npm run report               measure everything, rewrite the README block
 *   npm run report:check         fail unless the README block matches the record
 *   WAKU_LIVE=1 npm run report   also measure the live Waku rows
 *   WAKU_LIVE=1 npm run report -- --only=live   measure just the live rows
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const ROOT = path.resolve(import.meta.dirname, '..')
const README = 'README.md'
const RECORD = path.join('docs', 'report.json')
const STUB = path.join('e2e', 'stub-chain.json')
const START_MARKER = '<!-- report:start -->'
const END_MARKER = '<!-- report:end -->'

const mode = process.argv.slice(2)
const check = mode.includes('--check')
const only = mode.find((argument) => argument.startsWith('--only='))?.slice('--only='.length)
/** Measurement steps a `--check` run never takes: it only re-renders the record. */
const live = process.env.WAKU_LIVE === '1'

// The per-module rows: label, which test files belong to it, and the command to
// reproduce just that bucket.
const MODULES = [
  { label: '- crypto module', prefix: 'src/crypto/', command: 'npx vitest run src/crypto' },
  { label: '- vault module', prefix: 'src/vault/', command: 'npx vitest run src/vault' },
  { label: '- wallet engine', prefix: 'src/wallet/', command: 'npx vitest run src/wallet' },
  {
    label: '- messaging module',
    prefix: 'src/messaging/',
    command: 'npx vitest run src/messaging',
  },
  { label: '- security policy', prefix: 'src/security/', command: 'npx vitest run src/security' },
]

// Bundle chunks, identified by the names Vite gives them. A renamed chunk fails
// loudly below instead of quietly printing the wrong number.
const CHUNKS = [
  { label: 'Production bundle, app chunk', startsWith: 'index-', endsWith: '.js' },
  { label: 'Production bundle, CSS', startsWith: 'index-', endsWith: '.css' },
  { label: 'Production bundle, lazily loaded libsodium chunk', startsWith: 'libsodium-wrappers-' },
  { label: 'Production bundle, lazily loaded Waku SDK chunk', startsWith: 'dist-' },
  { label: 'Production bundle, Waku adapter chunk', startsWith: 'waku-' },
]

/** Windows needs a shell for `npx.cmd`; one argument needs quoting only if it has a space. */
function quote(value) {
  return /\s/.test(value) ? `"${value}"` : value
}

function run(command, args, options = {}) {
  const common = {
    cwd: ROOT,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  }

  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args].map(quote).join(' '), { ...common, shell: true })
      : spawnSync(command, args, common)

  if (result.status !== 0 && !options.allowFailure) {
    process.stderr.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error(`\`${command} ${args.join(' ')}\` exited with ${result.status}`)
  }

  return result
}

/**
 * Scratch space for the JSON reporters. Inside the repo's ignored `node_modules`
 * rather than the system temp directory, so no argument ever contains a space.
 */
function tempFile(name) {
  const directory = path.join(ROOT, 'node_modules', '.cache', 'oblivion-report')
  fs.mkdirSync(directory, { recursive: true })
  return path.join(directory, `${name}-${process.pid}.json`)
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/')
}

/** Runs Vitest with its JSON reporter and returns the parsed report. */
function vitest(args) {
  const output = tempFile('vitest')
  const started = Date.now()
  run('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${output}`, ...args])
  const wallSeconds = (Date.now() - started) / 1000

  try {
    return { report: JSON.parse(fs.readFileSync(output, 'utf8')), wallSeconds }
  } finally {
    fs.rmSync(output, { force: true })
  }
}

const PAY_IN_CHAT_TITLE = 'pays a request in one click and posts the hash back into the thread'

function measureUnitTests() {
  const { report, wallSeconds } = vitest([])
  const passed = report.numPassedTests
  const skipped = report.numPendingTests

  const modules = MODULES.map((module) => {
    const own = report.testResults.filter((file) => relative(file.name).startsWith(module.prefix))
    const tests = own.reduce(
      (total, file) =>
        total + file.assertionResults.filter((assertion) => assertion.status === 'passed').length,
      0,
    )
    const pending = own.reduce(
      (total, file) =>
        total + file.assertionResults.filter((assertion) => assertion.status !== 'passed').length,
      0,
    )
    return { ...module, tests, pending }
  })

  const uiFiles = report.testResults.filter((file) => {
    const name = relative(file.name)
    return name === 'src/App.test.tsx' || name.startsWith('src/ui/')
  })
  const uiTests = uiFiles.reduce(
    (total, file) =>
      total + file.assertionResults.filter((assertion) => assertion.status === 'passed').length,
    0,
  )

  const titles = new Map()
  for (const file of report.testResults) {
    for (const assertion of file.assertionResults) {
      titles.set(assertion.title, assertion.duration ?? 0)
    }
  }

  return {
    passed,
    skipped,
    files: report.testResults.length,
    skippedFiles: report.testResults.filter((file) => file.status !== 'passed').length,
    wallSeconds: Number(wallSeconds.toFixed(1)),
    modules,
    uiTests,
    payInChatSeconds: Number(((titles.get(PAY_IN_CHAT_TITLE) ?? 0) / 1000).toFixed(1)),
  }
}

const LIVE_FRAME_TITLE = 'connects a light node and carries a frame back to this subscriber'
const LIVE_DIRECT_TITLE = 'carries a sealed direct message between two live light nodes'

function measureLive() {
  if (!live) {
    return {
      status: 'not-measured',
      reason: 'opt-in: needs outbound network access',
      frameSeconds: null,
      directMessageSeconds: null,
    }
  }

  const output = tempFile('waku-live')
  const result = run(
    'npx',
    [
      'vitest',
      'run',
      '--environment',
      'node',
      '--reporter=json',
      `--outputFile=${output}`,
      'src/messaging/waku.live.test.ts',
    ],
    { allowFailure: true },
  )

  if (!fs.existsSync(output)) {
    return {
      status: 'failed',
      reason: `the live run produced no report (exit ${result.status})`,
      frameSeconds: null,
      directMessageSeconds: null,
    }
  }

  const report = JSON.parse(fs.readFileSync(output, 'utf8'))
  fs.rmSync(output, { force: true })

  const assertions = report.testResults.flatMap((file) => file.assertionResults)
  const seconds = (title) => {
    const found = assertions.find((assertion) => assertion.title === title)
    if (!found || found.status !== 'passed') return null
    return Number(((found.duration ?? 0) / 1000).toFixed(1))
  }

  const frameSeconds = seconds(LIVE_FRAME_TITLE)
  const directMessageSeconds = seconds(LIVE_DIRECT_TITLE)

  if (frameSeconds === null || directMessageSeconds === null) {
    const failure = assertions.find((assertion) => assertion.status === 'failed')
    const firstLine = (failure?.failureMessages?.[0] ?? 'the network was not reachable').split(
      '\n',
    )[0]

    return {
      status: 'failed',
      reason: `the live run failed on this machine: ${firstLine}`,
      frameSeconds: null,
      directMessageSeconds: null,
    }
  }

  return { status: 'measured', reason: null, frameSeconds, directMessageSeconds }
}

function measureBuild() {
  const build = run('npm', ['run', 'build'])
  const output = `${build.stdout ?? ''}\n${build.stderr ?? ''}`
  const assets = new Map()

  const line = /^dist\/assets\/(\S+)\s+([\d.]+) kB\s+│ gzip:\s+([\d.]+) kB/gm
  for (const match of output.matchAll(line)) {
    assets.set(match[1], { rawKb: match[2], gzipKb: match[3] })
  }

  if (assets.size === 0) {
    throw new Error('could not read any chunk sizes out of the vite build output')
  }

  const chunks = CHUNKS.map((chunk) => {
    const found = [...assets.entries()].find(
      ([file]) =>
        file.startsWith(chunk.startsWith) && (!chunk.endsWith || file.endsWith(chunk.endsWith)),
    )

    if (!found) {
      throw new Error(
        `no chunk matching "${chunk.startsWith}*${chunk.endsWith ?? ''}" in the build output (${[
          ...assets.keys(),
        ].join(', ')})`,
      )
    }

    return { label: chunk.label, file: found[0], ...found[1] }
  })

  return { chunks, chunkCount: assets.size }
}

async function measureArgon2() {
  const module = await import('libsodium-wrappers-sumo')
  const sodium = module.default ?? module
  await sodium.ready

  const salt = randomBytes(16)
  const started = performance.now()

  sodium.crypto_pwhash(
    32,
    'oblivion-report-script',
    salt,
    3,
    64 * 1024 * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  )

  return Number(((performance.now() - started) / 1000).toFixed(2))
}

function measureAudit() {
  const result = run('npm', ['audit', '--json'], { allowFailure: true })

  try {
    const parsed = JSON.parse(result.stdout ?? '')
    const counts = parsed.metadata?.vulnerabilities
    if (!counts || typeof counts.total !== 'number') throw new Error('no vulnerability counts')

    return {
      status: 'measured',
      total: counts.total,
      info: counts.info ?? 0,
      low: counts.low ?? 0,
      moderate: counts.moderate ?? 0,
      high: counts.high ?? 0,
      critical: counts.critical ?? 0,
    }
  } catch {
    return { status: 'not-measured', reason: 'npm audit needs the network' }
  }
}

function measureE2E() {
  const output = tempFile('playwright')
  const result = run('npx', ['playwright', 'test', '--reporter=json'], {
    allowFailure: true,
    env: { PLAYWRIGHT_JSON_OUTPUT_NAME: output },
  })

  if (!fs.existsSync(output)) {
    process.stderr.write(result.stderr ?? '')
    throw new Error('playwright produced no JSON report')
  }

  const report = JSON.parse(fs.readFileSync(output, 'utf8'))
  fs.rmSync(output, { force: true })

  const errors = report.errors ?? []
  if (errors.length > 0) {
    throw new Error(`playwright reported an error: ${errors[0].message}`)
  }

  if (report.stats.expected === 0) {
    throw new Error('playwright ran no tests — refusing to report 0 passing as a measurement')
  }

  if (report.stats.unexpected > 0) {
    throw new Error(`playwright reported ${report.stats.unexpected} failing test(s)`)
  }

  return {
    expected: report.stats.expected,
    unexpected: report.stats.unexpected,
    skipped: report.stats.skipped,
    seconds: Number((report.stats.duration / 1000).toFixed(1)),
  }
}

function measure() {
  const unit = measureUnitTests()
  const build = measureBuild()
  const e2e = measureE2E()

  return measureRest({ unit, build, e2e })
}

async function measureRest({ unit, build, e2e }) {
  return {
    generatedAt: new Date().toISOString(),
    node: process.versions.node,
    platform: process.platform,
    unit,
    build,
    e2e,
    live: measureLive(),
    argon2Seconds: await measureArgon2(),
    audit: measureAudit(),
    fixture: JSON.parse(fs.readFileSync(path.join(ROOT, STUB), 'utf8')),
  }
}

/** 21000 → "21 000", matching the README's house style for large numbers. */
function group(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function platformName(platform) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'darwin') return 'macOS'
  return 'Linux'
}

function auditValue(audit) {
  if (audit.status !== 'measured') return `not measured — ${audit.reason}`
  if (audit.total === 0) return '0 — none reported'

  const parts = ['moderate', 'high', 'critical']
    .filter((severity) => audit[severity] > 0)
    .map((severity) => `${audit[severity]} ${severity}`)
    .join(', ')

  return `${audit.total} (${parts}) — reported in CI, non-blocking`
}

function rows(record) {
  const { unit, build, e2e, live, audit, fixture } = record

  const rows = [
    {
      measurement: 'Unit tests (Vitest)',
      value: `${unit.passed} passing, ${unit.files} files${unit.skipped > 0 ? ` (${unit.skipped} more skipped)` : ''}, ${unit.wallSeconds} s wall time`,
      command: 'npm test',
    },
  ]

  for (const module of unit.modules) {
    rows.push({
      measurement: module.label,
      value: `${module.tests} tests${module.pending > 0 ? ` (${module.pending} skipped unless opted in)` : ''}`,
      command: module.command,
    })
  }

  rows.push({
    measurement: '- app + UI (wallet, QR, chat and pay-in-chat panels)',
    value: `${unit.uiTests} tests`,
    command: 'npx vitest run src/App.test.tsx src/ui',
  })

  rows.push({
    measurement: 'End-to-end (Playwright, Chromium, built app)',
    value: `${e2e.expected} passing (${e2e.seconds} s)`,
    command: 'npm run test:e2e',
  })

  rows.push({
    measurement: 'Live Waku: a light node carries one transport frame',
    value:
      live.frameSeconds === null
        ? `not measured here — ${live.reason}`
        : `${live.frameSeconds} s (peer discovery included)`,
    command: 'WAKU_LIVE=1 npm run report',
  })

  rows.push({
    measurement: 'Live Waku: two light nodes trade a sealed direct message',
    value:
      live.directMessageSeconds === null
        ? `not measured here — ${live.reason}`
        : `${live.directMessageSeconds} s (peer discovery included)`,
    command: '(same command)',
  })

  for (const chunk of build.chunks) {
    rows.push({
      measurement: chunk.label,
      value: `${chunk.rawKb} kB (${chunk.gzipKb} kB gzip)`,
      command: 'npm run build',
    })
  }

  rows.push({
    measurement: 'Argon2id at the default `interactive` profile',
    value: `${record.argon2Seconds} s per derivation`,
    command: 'npm run report',
  })

  rows.push({
    measurement: 'Dependency advisories (`npm audit`)',
    value: auditValue(audit),
    command: 'npm audit',
  })

  rows.push({
    measurement: 'Pay-in-chat loop in the UI (ask → one click → hash back)',
    value: `${unit.payInChatSeconds} s per run (in-memory network + fake chain)`,
    command: 'npx vitest run src/ui/messaging-context.test.tsx',
  })

  rows.push({
    measurement: `Fee shown for a ${fixture.sendAmountEth} ETH send at a ${fixture.gasPriceGwei} gwei gas price`,
    value: `${fixture.worstCaseFeeEth} ETH (worst case, ${group(fixture.gasLimit)} gas × a ${fixture.maxFeePerGasGwei} gwei cap)`,
    command: 'npx playwright test e2e/wallet.spec.ts',
  })

  rows.push({
    measurement: 'Real Sepolia RPC response times',
    value: 'not measured — needs a funded endpoint on the day; it varies by provider',
    command: 'npm run report',
  })

  rows.push({
    measurement: 'On-device mobile numbers',
    value: 'not measured — there is no mobile build',
    command: 'npm run report',
  })

  return rows
}

function renderBlock(record) {
  const table = [
    ['Measurement', 'Value', 'Command'],
    ...rows(record).map((row) => [row.measurement, row.value, `\`${row.command}\``]),
  ]

  const widths = table[0].map((_, column) => Math.max(...table.map((line) => line[column].length)))

  const render = (line) =>
    `| ${line.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`
  const body = [render(table[0]), separator, ...table.slice(1).map(render)].join('\n')

  const date = record.generatedAt.slice(0, 10)

  return [
    START_MARKER,
    `Every number below was produced by this repo on ${date} with \`npm run report\` (Node ${record.node}, ${platformName(record.platform)}). A measurement this machine cannot take is reported as **not measured** with the reason, never guessed. The raw output the script parsed is committed as [\`docs/report.json\`](docs/report.json), and \`npm run report:check\` fails if this block stops matching it.`,
    '',
    body,
    END_MARKER,
  ].join('\n')
}

function replaceBlock(readme, block) {
  const start = readme.indexOf(START_MARKER)
  const end = readme.indexOf(END_MARKER)

  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md must contain ${START_MARKER} … ${END_MARKER}`)
  }

  return `${readme.slice(0, start)}${block}${readme.slice(end + END_MARKER.length)}`
}

function prettier(text) {
  return run('npx', ['prettier', '--stdin-filepath', README], { input: text }).stdout ?? ''
}

async function main() {
  if (only === 'live') {
    const measurement = measureLive()
    process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`)
    return
  }

  if (check) {
    if (!fs.existsSync(path.join(ROOT, RECORD))) {
      throw new Error(`${RECORD} is missing — run \`npm run report\` first`)
    }

    const record = JSON.parse(fs.readFileSync(path.join(ROOT, RECORD), 'utf8'))
    const readme = fs.readFileSync(path.join(ROOT, README), 'utf8')
    const expected = prettier(replaceBlock(readme, renderBlock(record)))

    if (prettier(readme) !== expected) {
      throw new Error(
        'the README Results block does not match docs/report.json — run `npm run report`',
      )
    }

    process.stdout.write('report: README matches docs/report.json\n')
    return
  }

  const record = await measure()
  const readme = fs.readFileSync(path.join(ROOT, README), 'utf8')

  fs.writeFileSync(path.join(ROOT, README), replaceBlock(readme, renderBlock(record)))
  run('npx', ['prettier', '--write', README])
  fs.writeFileSync(path.join(ROOT, RECORD), `${JSON.stringify(record, null, 2)}\n`)

  const skipped = rows(record).filter((row) => row.value.startsWith('not measured'))
  process.stdout.write(
    `report: wrote ${RECORD} and the README block (${rows(record).length} rows, ${skipped.length} not measured)\n`,
  )
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
