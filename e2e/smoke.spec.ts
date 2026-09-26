import { expect, test } from '@playwright/test'

test('built app loads and shows the safety banner', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/Oblivion/)
  await expect(page.getByRole('heading', { level: 1, name: 'Oblivion' })).toBeVisible()

  const banner = page.getByTestId('safety-banner')
  await expect(banner).toContainText('testnet only')
  await expect(banner).toContainText('Do not use with real funds or sensitive conversations.')
})

test('the built app ships the Content-Security-Policy', async ({ page }) => {
  await page.goto('/')

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')

  expect(policy).toContain("default-src 'self'")
  expect(policy).toContain("'wasm-unsafe-eval'")
  expect(policy).not.toContain("'unsafe-eval'")
})
