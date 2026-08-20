import { chromium, devices } from 'playwright'

export const BASE_URL = process.env.ENAB_URL ?? 'http://localhost:4173/'
/** Set when Chromium lives outside Playwright's default download location. */
const EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM

/**
 * @param {{ width?: number, height?: number, device?: string }} [options]
 *   Pass `device` to emulate a real phone — touch and a coarse pointer, which
 *   several styles key off.
 */
export async function launch({ width = 1280, height = 950, device } = {}) {
  const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {})
  const context = await browser.newContext(
    device
      ? { ...devices[device], acceptDownloads: true }
      : { viewport: { width, height }, acceptDownloads: true },
  )
  const page = await context.newPage()

  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await dismissInstallGuide(page)
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

/** True on a phone layout, where the sidebar is an off-canvas drawer. */
async function onPhone(page) {
  return page.locator('.nav-menu-btn').isVisible().catch(() => false)
}

/** Open the navigation drawer on a phone (no-op on desktop). */
async function openDrawer(page) {
  if (await onPhone(page)) {
    await page.locator('.nav-menu-btn').click()
    await page.waitForTimeout(320)
  }
}

/** Works at both desktop and phone widths. */
export async function addTransaction(page) {
  // The Budget screen carries a one-tap quick-add in its top bar.
  const quick = page.locator('.topbar .add-txn')
  if (await quick.isVisible().catch(() => false)) {
    await quick.click()
    return
  }
  // Otherwise use Add Transaction in the sidebar — docked on desktop, revealed
  // by the drawer on a phone.
  await openDrawer(page)
  await page.locator('.sidebar').getByRole('button', { name: 'Add Transaction' }).click()
}

/**
 * Navigate to a section by its label, using the sidebar — docked on desktop,
 * opened as a drawer on a phone.
 */
export async function gotoSection(page, label) {
  await openDrawer(page)
  // The accounts link reads "All Accounts"; everything else matches from the
  // start of its label.
  const rx = label === 'Accounts' ? /All Accounts/ : new RegExp('^' + label)
  await page.locator('.sidebar').getByRole('link', { name: rx }).first().click()
  await page.waitForTimeout(500)
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

/**
 * A fresh profile gets the "add to Home Screen" guide on first open, exactly
 * as a real user does. Close it before the suite starts.
 */
export async function dismissInstallGuide(page) {
  const gotIt = page.getByRole('button', { name: 'Got it' })
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click()
    await page.waitForTimeout(400)
  }
}
