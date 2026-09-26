import { describe, expect, it } from 'vitest'

import {
  QrEncodeError,
  QR_QUIET_ZONE_MODULES,
  buildQrMatrix,
  isDark,
  qrPathData,
  qrViewBoxSize,
} from './qr'

const ADDRESS = `0x${'ab'.repeat(20)}`

describe('buildQrMatrix', () => {
  it('encodes a short payload as a version 1 symbol', () => {
    const matrix = buildQrMatrix('x')
    expect(matrix.version).toBe(1)
    expect(matrix.size).toBe(21)
    expect(matrix.modules).toHaveLength(21 * 21)
  })

  it('keeps the three finder patterns in their corners', () => {
    const matrix = buildQrMatrix(ADDRESS)

    // Top-left finder: a 7x7 dark ring with a 3x3 dark core.
    expect(isDark(matrix, 0, 0)).toBe(true)
    expect(isDark(matrix, 6, 6)).toBe(true)
    expect(isDark(matrix, 3, 3)).toBe(true)
    expect(isDark(matrix, 1, 1)).toBe(false)

    const last = matrix.size - 1
    expect(isDark(matrix, last, 0)).toBe(true)
    expect(isDark(matrix, last - 6, 6)).toBe(true)
    expect(isDark(matrix, 0, last)).toBe(true)
  })

  it('defaults to the M error-correction level', () => {
    expect(buildQrMatrix(ADDRESS).errorCorrectionLevel).toBe('M')
  })

  it('honours a requested error-correction level', () => {
    expect(buildQrMatrix(ADDRESS, { errorCorrectionLevel: 'H' }).errorCorrectionLevel).toBe('H')
    expect(buildQrMatrix(ADDRESS, { errorCorrectionLevel: 'L' }).errorCorrectionLevel).toBe('L')
  })

  it('grows the symbol as the payload grows', () => {
    const small = buildQrMatrix('hi')
    const large = buildQrMatrix('a'.repeat(400))
    expect(large.size).toBeGreaterThan(small.size)
  })

  it('is stable for the same payload', () => {
    expect(buildQrMatrix(ADDRESS).modules).toEqual(buildQrMatrix(ADDRESS).modules)
  })

  it('changes when a single character changes', () => {
    const left = buildQrMatrix(`ethereum:${ADDRESS}?value=1`)
    const right = buildQrMatrix(`ethereum:${ADDRESS}?value=2`)
    expect(left.modules).not.toEqual(right.modules)
  })

  it('trims surrounding whitespace', () => {
    expect(buildQrMatrix(`  ${ADDRESS}  `).modules).toEqual(buildQrMatrix(ADDRESS).modules)
  })

  it('refuses an empty payload', () => {
    expect(() => buildQrMatrix('   ')).toThrow(QrEncodeError)
  })

  it('refuses a payload that cannot fit any version', () => {
    expect(() => buildQrMatrix('a'.repeat(8000))).toThrow(QrEncodeError)
  })
})

describe('svg geometry', () => {
  it('adds the quiet zone on both sides', () => {
    const matrix = buildQrMatrix(ADDRESS)
    expect(qrViewBoxSize(matrix)).toBe(matrix.size + QR_QUIET_ZONE_MODULES * 2)
  })

  it('emits one closed subpath per dark run', () => {
    const matrix = buildQrMatrix(ADDRESS)
    const path = qrPathData(matrix)
    const darkRuns = countDarkRuns(matrix)

    expect(path.match(/M/g)).toHaveLength(darkRuns)
    expect(path.startsWith(`M${QR_QUIET_ZONE_MODULES}`)).toBe(true)
  })

  it('starts every subpath inside the quiet zone', () => {
    const matrix = buildQrMatrix(ADDRESS)
    const path = qrPathData(matrix)

    for (const match of path.matchAll(/M(\d+) (\d+)/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(QR_QUIET_ZONE_MODULES)
      expect(Number(match[2])).toBeGreaterThanOrEqual(QR_QUIET_ZONE_MODULES)
      expect(Number(match[1])).toBeLessThan(qrViewBoxSize(matrix) - QR_QUIET_ZONE_MODULES)
      expect(Number(match[2])).toBeLessThan(qrViewBoxSize(matrix) - QR_QUIET_ZONE_MODULES)
    }
  })

  it('treats out-of-range coordinates as light', () => {
    const matrix = buildQrMatrix(ADDRESS)
    expect(isDark(matrix, -1, 0)).toBe(false)
    expect(isDark(matrix, 0, matrix.size)).toBe(false)
  })
})

function countDarkRuns(matrix: ReturnType<typeof buildQrMatrix>): number {
  let runs = 0

  for (let y = 0; y < matrix.size; y += 1) {
    let inRun = false

    for (let x = 0; x < matrix.size; x += 1) {
      const dark = isDark(matrix, x, y)
      if (dark && !inRun) runs += 1
      inRun = dark
    }
  }

  return runs
}
