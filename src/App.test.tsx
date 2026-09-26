import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'
import { SAFETY_LABEL, SAFETY_WARNING } from './safety'

describe('app shell', () => {
  it('renders the required prototype / unaudited / testnet-only safety banner', () => {
    render(<App />)

    const banner = screen.getByTestId('safety-banner')

    expect(banner).toHaveTextContent(SAFETY_LABEL)
    expect(banner).toHaveTextContent('testnet only')
    expect(banner).toHaveTextContent(SAFETY_WARNING)
    expect(banner).toHaveTextContent('Do not use with real funds or sensitive conversations.')
  })

  it('names the app and states that milestone 1 is the current build state', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Oblivion' })).toBeVisible()
    expect(screen.getByText(/Milestone 1 of 8/i)).toBeVisible()
  })
})
