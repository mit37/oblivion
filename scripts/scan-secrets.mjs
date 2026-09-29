#!/usr/bin/env node
/**
 * Runs the pinned gitleaks binary over the whole history: the same scan CI runs,
 * by the same command, with the version pinned in exactly one place.
 *
 * Why a script instead of the marketplace action: `gitleaks/gitleaks-action@v2`
 * derives its range from the push event as `<parent of the first pushed
 * commit>^..<head>`. On a repository's first push that commit is the root and has
 * no parent, so git answers `fatal: ambiguous argument` and the job fails having
 * scanned nothing. A binary scanning `--all` cannot fail that way. The whole
 * story is in `docs/PLAN.md` under "The first push".
 *
 * The binary is downloaded once into `node_modules/.cache/gitleaks` (git-ignored)
 * and its SHA-256 is checked against the release's own checksums file before it
 * is allowed to run, so pinning the version pins the bytes too.
 *
 * Usage:
 *   npm run scan:secrets                   scan every commit in this repository
 *   npm run scan:secrets -- --self-check   ...and prove the rules still fire, by
 *                                          piping a fake credential through
 *   npm run scan:secrets -- --path=<exe>   use a gitleaks already on this machine
 *
 * CI runs this script rather than a curl pipeline, so a failure here is the same
 * failure there. It is deliberately *not* part of `npm run verify`: that stays
 * offline, and this one downloads a binary on first use.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const VERSION = '8.24.3'
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'gitleaks')
const BIN_DIR = path.join(CACHE, 'bin')
const BIN = path.join(BIN_DIR, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks')
const REPORT = path.join(ROOT, 'gitleaks-results.sarif')
const BASE_URL = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}`

const args = process.argv.slice(2)
const selfCheck = args.includes('--self-check')
const explicitPath = args
  .find((argument) => argument.startsWith('--path='))
  ?.slice('--path='.length)

main()

async function main() {
  const binary = explicitPath ? path.resolve(explicitPath) : await ensureBinary()

  if (!fs.existsSync(binary)) fail(`no gitleaks binary at ${binary}`)

  console.log(`gitleaks ${VERSION} — scanning every commit in ${ROOT}\n`)

  const scan = run(binary, [
    'git',
    '--redact',
    '-v',
    '--exit-code',
    '1',
    '--report-format=sarif',
    `--report-path=${REPORT}`,
    '--log-opts=--all --no-merges',
    '.',
  ])

  if (scan !== 0) {
    console.error(
      `\nthe scan found something (exit ${scan}); the report is ${path.relative(ROOT, REPORT)}`,
    )
    console.error(
      'Read it before allowlisting anything: .gitleaks.toml names values, never whole files.',
    )
    process.exit(scan)
  }

  console.log('\nno leaks found.')

  if (selfCheck) process.exit(selfCheckRules(binary))

  process.exit(0)
}

/**
 * The scan above can only prove the rules did not fire. This proves they can:
 * a known-fake credential goes through the same binary on stdin, and the check
 * fails if it is *not* reported — which is what stops an over-broad allowlist
 * from quietly turning the scan into a no-op.
 */
function selfCheckRules(binary) {
  const result = spawnSync(binary, ['stdin', '--redact', '--no-banner'], {
    input: controlSecret(),
    encoding: 'utf8',
    cwd: ROOT,
  })

  const detected = result.status === 1

  console.log(
    detected
      ? 'self-check: a control secret piped through the rules was caught, so the allowlist is a filter rather than a mute.'
      : 'self-check: FAILED — the control secret was not caught, so the rules are not firing.',
  )

  return detected ? 0 : 1
}

/**
 * A credential-shaped string that is not a credential: 20 random bytes in hex,
 * different on every run, held in memory and piped straight to the scanner. It
 * is generated rather than written down so this file contains no secret-shaped
 * literal — the scan above reads this repository's history too.
 */
function controlSecret() {
  return `github_token = "ghp_${randomBytes(20).toString('hex')}"\n`
}

/** Downloads the pinned release asset for this platform, verifies it, unpacks it. */
async function ensureBinary() {
  if (fs.existsSync(BIN)) return BIN

  const asset = assetFor(process.platform, process.arch)
  const archive = path.join(CACHE, asset.name)

  fs.mkdirSync(BIN_DIR, { recursive: true })

  if (!fs.existsSync(archive)) {
    console.log(`downloading ${asset.name} (once; cached in node_modules/.cache)`)
    await download(`${BASE_URL}/${asset.name}`, archive)
  }

  await verifyChecksum(archive, asset.name)
  extract(archive, asset)

  if (process.platform !== 'win32') fs.chmodSync(BIN, 0o755)

  return BIN
}

function assetFor(platform, arch) {
  const cpu = { x64: 'x64', arm64: 'arm64', ia32: 'x32' }[arch]

  if (!cpu) fail(`no gitleaks ${VERSION} build for ${platform}/${arch}; pass --path=<binary>`)

  const family = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : 'linux'
  const extension = family === 'windows' ? 'zip' : 'tar.gz'
  const name = `gitleaks_${VERSION}_${family}_${cpu}.${extension}`

  if (family === 'windows' && cpu === 'arm64') {
    fail(`no gitleaks ${VERSION} build for ${platform}/${arch}; pass --path=<binary>`)
  }

  return { name, zipped: family === 'windows' }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })

  if (!response.ok) fail(`could not download ${url} (HTTP ${response.status})`)

  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()))
}

/**
 * The release publishes its own checksums file; a download that does not match
 * it is discarded rather than run. This is the only reason the script talks to
 * the network at all on a machine that already has the binary.
 */
async function verifyChecksum(archive, name) {
  const response = await fetch(`${BASE_URL}/gitleaks_${VERSION}_checksums.txt`, {
    redirect: 'follow',
  })

  if (!response.ok) fail(`could not download the checksums file (HTTP ${response.status})`)

  const expected = (await response.text())
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .find(([, file]) => file === name)?.[0]

  if (!expected) fail(`${name} is not listed in gitleaks_${VERSION}_checksums.txt`)

  const actual = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')

  if (actual !== expected) {
    fs.rmSync(archive, { force: true })
    fail(`checksum mismatch for ${name}: expected ${expected}, downloaded ${actual}`)
  }

  console.log(`checksum verified: ${name} is ${expected.slice(0, 16)}…`)
}

function extract(archive, asset) {
  const command = asset.zipped
    ? [
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -Force -LiteralPath '${archive}' -DestinationPath '${BIN_DIR}'`,
        ],
      ]
    : ['tar', ['-xzf', archive, '-C', BIN_DIR, 'gitleaks']]

  const [file, rest] = command

  if (run(file, rest) !== 0) fail(`could not unpack ${asset.name}`)
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: 'inherit' })

  if (result.error) fail(`could not run ${command}: ${result.error.message}`)

  return result.status ?? 1
}

function fail(message) {
  console.error(`scan-secrets: ${message}`)
  process.exit(1)
}
