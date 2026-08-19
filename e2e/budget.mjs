/**
 * Budget mechanics — end-to-end against a built preview server.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, addTransaction } from './harness.mjs'

const { browser, page, errors } = await launch()

// ---- 1. create a checking account -------------------------------------
await step('add checking account', async () => {
  await page.getByRole('button', { name: 'Add your first account' }).click()
  await page.getByLabel('Account name').fill('Checking')
  await page.getByLabel('Account type').selectOption('checking')
  await page.getByLabel("Today's balance").fill('3000')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.waitForTimeout(600)
})

// ---- 2. create a credit card ------------------------------------------
await step('add credit card', async () => {
  await page.getByRole('button', { name: 'Add Account' }).click()
  await page.getByLabel('Account name').fill('Visa')
  await page.getByLabel('Account type').selectOption('creditCard')
  await page.getByLabel('Amount you currently owe').fill('0')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.waitForTimeout(600)
})

// ---- 3. budget screen: check Ready to Assign ---------------------------
await step('ready to assign shows starting balance', async () => {
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(500)
  const rta = await page.locator('.rta-amount').innerText()
  if (rta !== '$3,000.00') throw new Error(`expected $3,000.00, got ${rta}`)
})

// ---- 4. assign money to Groceries -------------------------------------
await step('assign to Groceries', async () => {
  const row = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  await row.locator('input.assign-input').fill('400')
  await row.locator('input.assign-input').press('Enter')
  await page.waitForTimeout(400)
  const avail = await row.locator('.avail-pill').innerText()
  if (avail !== '$400.00') throw new Error(`available was ${avail}`)
  const rta = await page.locator('.rta-amount').innerText()
  if (rta !== '$2,600.00') throw new Error(`RTA was ${rta}`)
})

// ---- 5. spend on the credit card --------------------------------------
await step('credit card purchase funds the payment category', async () => {
  await addTransaction(page)
  await page.getByLabel('Amount', { exact: true }).fill('150')
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Visa' })
  await page.getByLabel('Payee', { exact: true }).fill('Grocer')
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Groceries' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(700)

  const groceries = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  const avail = await groceries.locator('.avail-pill').innerText()
  if (avail !== '$250.00') throw new Error(`Groceries available was ${avail}, expected $250.00`)

  const payment = page.locator('.cat-row', { hasText: 'Visa' }).first()
  const payAvail = await payment.locator('.avail-pill').innerText()
  if (payAvail !== '$150.00') throw new Error(`Visa payment available was ${payAvail}, expected $150.00`)
})

// ---- 6. overspend with cash -------------------------------------------
await step('cash overspending turns the pill red', async () => {
  await addTransaction(page)
  await page.getByLabel('Amount', { exact: true }).fill('900')
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Checking' })
  await page.getByLabel('Payee', { exact: true }).fill('Big Store')
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Groceries' })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(700)
  const groceries = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  const cls = await groceries.locator('.avail-pill').getAttribute('class')
  if (!cls.includes('overspent-cash')) throw new Error(`pill class was ${cls}`)
})

// ---- 7. set a target ---------------------------------------------------
await step('create a monthly target', async () => {
  await page.locator('.cat-row', { hasText: 'Rent/Mortgage' }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Create a target/ }).click()
  await page.getByLabel('Amount each period').fill('1200')
  await page.getByRole('button', { name: 'Save target' }).click()
  await page.waitForTimeout(500)
  const body = await page.locator('.drawer-body').innerText()
  if (!body.includes('$1,200.00 still needed')) throw new Error(`drawer said: ${body.slice(0, 200)}`)
  await page.locator('.drawer-head .icon-btn').click()
  await page.waitForTimeout(300)
})

// ---- 8. auto-assign underfunded ---------------------------------------
await step('auto-assign underfunded', async () => {
  await page.getByRole('button', { name: /Auto-Assign/ }).click()
  await page.getByRole('menuitem').first().waitFor({ state: 'attached', timeout: 1000 }).catch(() => {})
  await page.locator('.menu button', { hasText: 'Underfunded' }).click()
  await page.waitForTimeout(600)
  const rent = page.locator('.cat-row', { hasText: 'Rent/Mortgage' }).first()
  const assigned = await rent.locator('input.assign-input').inputValue()
  if (assigned !== '$1,200.00') throw new Error(`rent assigned was "${assigned}"`)
})

// ---- 9. transfer between accounts -------------------------------------
await step('transfer to pay the card', async () => {
  await addTransaction(page)
  await page.getByLabel('Amount', { exact: true }).fill('150')
  await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Checking' })
  await page.getByLabel('Payee', { exact: true }).fill('Transfer : Visa')
  await page.waitForTimeout(300)
  await page.locator('.menu button', { hasText: 'Transfer : Visa' }).first().click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(700)
  const payment = page.locator('.cat-row', { hasText: 'Visa' }).first()
  const payAvail = await payment.locator('.avail-pill').innerText()
  if (payAvail !== '$0.00') throw new Error(`Visa payment available after paying was ${payAvail}`)
})

// ---- 10. reports -------------------------------------------------------
await step('reports render', async () => {
  await page.getByRole('link', { name: 'Reports' }).first().click()
  await page.waitForTimeout(900)
  const svgCount = await page.locator('svg[role=img]').count()
  if (svgCount < 3) throw new Error(`only ${svgCount} charts rendered`)
})

// ---- 11. next month rollover ------------------------------------------
await step('next month absorbs overspending', async () => {
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.waitForTimeout(600)
  const groceries = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  const avail = await groceries.locator('.avail-pill').innerText()
  if (avail !== '$0.00') throw new Error(`Groceries carried ${avail} into next month, expected $0.00`)
})

// ---- 12. mobile viewport ----------------------------------------------
await step('mobile layout', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: 'Previous month' }).click()
  await page.waitForTimeout(400)
  const navVisible = await page.locator('.bottom-nav').isVisible()
  if (!navVisible) throw new Error('bottom nav missing on mobile')
})
await page.locator('.bottom-nav a', { hasText: 'Accounts' }).click()
await page.waitForTimeout(500)

console.log('\nERRORS:', errors.length ? errors : 'none')
await browser.close()
finish(errors)
