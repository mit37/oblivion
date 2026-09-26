/**
 * QR rendering.
 *
 * `qrcode` produces the module matrix; the SVG is drawn here so the markup is
 * ours (no `dangerouslySetInnerHTML`, no canvas, and it renders the same in
 * jsdom as in a browser). Four-module quiet zone per the spec.
 */
import QRCode from 'qrcode'

export const QR_QUIET_ZONE_MODULES = 4

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrMatrix {
  readonly size: number
  /** Row-major, `size * size` entries: true is a dark module. */
  readonly modules: readonly boolean[]
  readonly errorCorrectionLevel: QrErrorCorrectionLevel
  readonly version: number
}

export class QrEncodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QrEncodeError'
  }
}

/**
 * Encodes `value` into a module matrix. The payload is used verbatim apart from
 * surrounding whitespace, because a QR that silently rewrites its content is
 * worse than one that fails.
 */
export function buildQrMatrix(
  value: string,
  options: { errorCorrectionLevel?: QrErrorCorrectionLevel } = {},
): QrMatrix {
  const payload = value.trim()

  if (payload.length === 0) {
    throw new QrEncodeError('nothing to encode: the value is empty')
  }

  let qr: ReturnType<typeof QRCode.create>

  try {
    qr = QRCode.create(payload, {
      errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    })
  } catch (cause) {
    // Oversized payloads throw a plain Error; one error type for callers.
    throw new QrEncodeError(cause instanceof Error ? cause.message : 'QR encoding failed')
  }

  const size = qr.modules.size
  const data = qr.modules.data

  return {
    size,
    modules: Array.from({ length: size * size }, (_, index) => data[index] === 1),
    errorCorrectionLevel: fromBit(qr.errorCorrectionLevel.bit),
    version: qr.version,
  }
}

export function isDark(matrix: QrMatrix, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= matrix.size || y >= matrix.size) return false
  return matrix.modules[y * matrix.size + x] === true
}

/** Total SVG user units: modules plus the quiet zone on both sides. */
export function qrViewBoxSize(matrix: QrMatrix, quietZone = QR_QUIET_ZONE_MODULES): number {
  return matrix.size + quietZone * 2
}

/**
 * One SVG path for every dark module, with horizontal runs merged so the output
 * stays small (a version-4 symbol is a few kilobytes, not tens).
 */
export function qrPathData(matrix: QrMatrix, quietZone = QR_QUIET_ZONE_MODULES): string {
  const commands: string[] = []

  for (let y = 0; y < matrix.size; y += 1) {
    let x = 0

    while (x < matrix.size) {
      if (!isDark(matrix, x, y)) {
        x += 1
        continue
      }

      let run = 1
      while (x + run < matrix.size && isDark(matrix, x + run, y)) run += 1

      commands.push(`M${x + quietZone} ${y + quietZone}h${run}v1h-${run}z`)
      x += run
    }
  }

  return commands.join('')
}

function fromBit(bit: number): QrErrorCorrectionLevel {
  // The `qrcode` package follows the spec bit values, which are not in the
  // L < M < Q < H order people expect.
  switch (bit) {
    case 1:
      return 'L'
    case 3:
      return 'Q'
    case 2:
      return 'H'
    default:
      return 'M'
  }
}
