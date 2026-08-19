import { chromium } from 'playwright'

export const BASE_URL = process.env.ENAB_URL ?? 'http://localhost:4173/'
/** Set when Chromium lives outside Playwright's default download location. */
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM

export async function launch({ width = 1280, height = 950 } = {}) {
  const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {})
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true })
  const page = await context.newPage()

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  return { browser, context, page, errors }
}

let failures = 0

export async function step(name, fn) {
  try {
    await fn()
    console.log(`  ok    ${name}`)
  } catch (error) {
    failures++
    console.log(`  FAIL  ${name}`)
    console.log(`        ${String(error.message).split('\n')[0]}`)
    throw error
  }
}

export function finish(errors) {
  if (errors.length) {
    console.log('\nUncaught page errors:')
    for (const e of errors.slice(0, 8)) console.log(`  ${e}`)
    failures += errors.length
  }
  if (failures > 0) {
    console.log(`\n${failures} failure(s)`)
    process.exit(1)
  }
  console.log('\nAll checks passed')
}

/** Works at both desktop and phone widths. */
export async function addTransaction(page) {
  const fab = page.locator('.fab')
  if (await fab.isVisible()) await fab.click()
  else await page.locator('.sidebar').getByRole('button', { name: 'Add Transaction' }).click()
}

export async function createAccount(page, { name, type = 'checking', balance = '0' }) {
  const first = page.getByRole('button', { name: 'Add your first account' })
  if (await first.isVisible().catch(() => false)) await first.click()
  else await page.getByRole('button', { name: 'Add Account' }).click()

  await page.getByLabel('Account name').fill(name)
  await page.getByLabel('Account type').selectOption(type)
  await page.waitForTimeout(150)
  await page.locator('.modal input.amount').fill(balance)
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.waitForTimeout(700)
}

export async function gotoBudget(page) {
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(600)
}
