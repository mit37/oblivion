import { useEffect, useState } from 'react'

import { copyToClipboard } from './clipboard'

export interface CopyButtonProps {
  readonly value: string
  /** What is being copied, used in the button text: "Copy address". */
  readonly subject: string
  readonly disabled?: boolean
}

export function CopyButton({ value, subject, disabled }: CopyButtonProps) {
  // `null` until the first attempt, so a fresh button says nothing about a copy
  // that has not happened.
  const [result, setResult] = useState<'copied' | 'failed' | null>(null)

  useEffect(() => {
    if (result === null) return

    const timer = setTimeout(() => {
      setResult(null)
    }, 4000)

    return () => {
      clearTimeout(timer)
    }
  }, [result])

  return (
    <span className="copy">
      <button
        type="button"
        className="button"
        disabled={disabled}
        onClick={() => {
          void copyToClipboard(value).then((copied) => {
            setResult(copied ? 'copied' : 'failed')
          })
        }}
      >
        Copy {subject}
      </button>
      {result === 'copied' ? (
        <span className="form-note" role="status">
          Copied.
        </span>
      ) : null}
      {result === 'failed' ? (
        <span className="form-error" role="alert">
          Copying is blocked here; select the text instead.
        </span>
      ) : null}
    </span>
  )
}
