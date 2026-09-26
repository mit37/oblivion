import { useMemo } from 'react'

import {
  QrEncodeError,
  buildQrMatrix,
  qrPathData,
  qrViewBoxSize,
  type QrErrorCorrectionLevel,
} from './qr'

export interface QrCodeProps {
  readonly value: string
  /** Accessible name; also what a screen reader announces. */
  readonly label: string
  /** Rendered edge length in CSS pixels. */
  readonly size?: number
  readonly errorCorrectionLevel?: QrErrorCorrectionLevel
  readonly className?: string
}

/**
 * Renders `value` as a QR code. When the payload cannot be encoded the component
 * says so instead of drawing a symbol that would scan to the wrong thing.
 */
export function QrCode({
  value,
  label,
  size = 208,
  errorCorrectionLevel = 'M',
  className,
}: QrCodeProps) {
  const encoded = useMemo(() => {
    try {
      return { ok: true as const, matrix: buildQrMatrix(value, { errorCorrectionLevel }) }
    } catch (cause) {
      return {
        ok: false as const,
        message: cause instanceof QrEncodeError ? cause.message : 'QR encoding failed',
      }
    }
  }, [value, errorCorrectionLevel])

  if (!encoded.ok) {
    return (
      <p className="muted small" role="alert" data-testid="qr-error">
        {encoded.message}
      </p>
    )
  }

  const { matrix } = encoded
  const viewBox = qrViewBoxSize(matrix)

  return (
    <svg
      className={className}
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      shapeRendering="crispEdges"
      data-testid="qr-code"
      data-qr-size={matrix.size}
      data-qr-version={matrix.version}
      data-qr-ecc={matrix.errorCorrectionLevel}
    >
      <rect width={viewBox} height={viewBox} fill="#ffffff" />
      <path d={qrPathData(matrix)} fill="#0b0f14" />
    </svg>
  )
}
