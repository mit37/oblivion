import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QrCode } from './QrCode'

const ADDRESS = `0x${'ab'.repeat(20)}`

describe('QrCode', () => {
  it('exposes the payload as an accessible image', () => {
    render(<QrCode value={`ethereum:${ADDRESS}`} label={`Receive at ${ADDRESS}`} />)

    expect(screen.getByRole('img', { name: `Receive at ${ADDRESS}` })).toBeInTheDocument()
  })

  it('draws a light background and a dark module path', () => {
    render(<QrCode value={ADDRESS} label="Receive" />)

    const svg = screen.getByTestId('qr-code')
    const path = svg.querySelector('path')

    expect(svg.querySelector('rect')).toHaveAttribute('fill', '#ffffff')
    expect(path?.getAttribute('d')).toMatch(/^M4 4/)
    expect(path?.getAttribute('fill')).toBe('#0b0f14')
  })

  it('covers the whole symbol plus the quiet zone with its viewBox', () => {
    render(<QrCode value={ADDRESS} label="Receive" />)

    const svg = screen.getByTestId('qr-code')
    const [minX, minY, width, height] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number)
    const modules = Number(svg.getAttribute('data-qr-size'))

    expect(minX).toBe(0)
    expect(minY).toBe(0)
    expect(width).toBe(modules + 8)
    expect(height).toBe(modules + 8)
  })

  it('renders at the requested pixel size', () => {
    render(<QrCode value={ADDRESS} label="Receive" size={120} />)

    expect(screen.getByTestId('qr-code')).toHaveAttribute('width', '120')
  })

  it('reports a payload it cannot encode instead of drawing it', () => {
    render(<QrCode value="" label="Receive" />)

    expect(screen.getByTestId('qr-error')).toHaveTextContent(/nothing to encode/i)
    expect(screen.queryByTestId('qr-code')).toBeNull()
  })
})
