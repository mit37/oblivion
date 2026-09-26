/**
 * Copying without a dependency.
 *
 * The async Clipboard API needs a secure context and a permission; headless
 * environments (and some desktops) do not have it. Both paths are tried, and the
 * caller gets a boolean so the UI can say what actually happened instead of
 * claiming success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (text.length === 0) return false

  try {
    const clipboard = globalThis.navigator?.clipboard

    if (clipboard?.writeText) {
      await clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied, or not a secure context: fall through to the legacy path.
  }

  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false

  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'

    document.body.appendChild(field)
    field.select()

    // `execCommand` is deprecated but is the only fallback; absence is not an error.
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy')
    document.body.removeChild(field)

    return copied
  } catch {
    return false
  }
}
