/**
 * Transactions, reconciling and backups — end-to-end against a built preview server.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, addTransaction } from './harness.mjs'

const { browser, page, errors } = await launch()

import { readFileSync } from 'node:fs'


await step('setup account', async () => {
  await page.getByRole('button', { name: 'Add your first account' }).click()
  await page.getByLabel('Account name').fill('Checking')
  await page.getByLabel("Today's balance").fill('2000')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.waitForTimeout(700)
})

await step('split transaction across categories', async () => {
  await addTransaction(page)
  await page.getByLabel('Amount', { exact: true }).fill('100')
  await page.getByLabel('Payee', { exact: true }).fill('Superstore')
  await page.getByRole('button', { name: /Split into multiple/ }).click()
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Add split' }).click()
  await page.waitForTimeout(200)
  const cats = page.locator('.split-row select')
  await cats.nth(0).selectOption({ label: 'Groceries' })
  await cats.nth(1).selectOption({ label: 'Household' }).catch(async () => {
    await cats.nth(1).selectOption({ label: 'Clothing' })
  })
  await page.getByRole('button', { name: 'Split evenly' }).click()
  await page.waitForTimeout(300)
  const remaining = await page.locator('.split-remaining').innerText()
  if (!remaining.includes('Fully split')) throw new Error(`remaining said: ${remaining}`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(700)
  // Creating an account lands on its register, so come back to the budget.
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(600)
  const groceries = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  const act = await groceries.locator('.cat-num.col-activity').innerText()
  if (act !== '-$50.00') throw new Error(`Groceries activity ${act}`)
})

await step('register shows the split', async () => {
  await page.getByRole('link', { name: 'All Accounts' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('.acct-list a').first().click()
  await page.waitForTimeout(600)
  const row = page.locator('.txn-row', { hasText: 'Superstore' })
  const text = await row.innerText()
  if (!text.includes('Split (2)')) throw new Error(`row said: ${text.replace(/\n/g, ' ')}`)
})

await step('reconcile with an adjustment', async () => {
  await page.locator('.topbar').getByRole('button', { name: 'Account options' }).click()
  await page.locator('.menu button', { hasText: 'Reconcile account' }).click()
  await page.waitForTimeout(400)
  await page.locator('.modal input.amount').fill('1975')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Finish reconciling' }).click()
  await page.waitForTimeout(800)
  const rows = await page.locator('.txn-row').allInnerTexts()
  if (!rows.some((r) => r.includes('Reconciliation Balance Adjustment'))) {
    throw new Error('no adjustment transaction created')
  }
  const cleared = await page.locator('.balances-strip .b').first().innerText()
  if (!cleared.includes('$1,975.00')) throw new Error(`cleared balance ${cleared.replace(/\n/g, ' ')}`)
})

await step('reconciled transactions are locked', async () => {
  const mark = page.locator('.txn-row').first().locator('.cleared-mark')
  await mark.click()
  await page.waitForTimeout(400)
  const toast = (await page.locator('.toast').allInnerTexts()).join(' | ')
  if (!toast.includes('locked')) throw new Error(`toast said ${toast}`)
  await page.waitForTimeout(2000)
})

await step('move money between categories', async () => {
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(500)
  const groceries = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  await groceries.locator('input.assign-input').fill('300')
  await groceries.locator('input.assign-input').press('Enter')
  await page.waitForTimeout(500)
  await groceries.locator('.avail-pill').click()
  await page.waitForTimeout(300)
  await page.locator('.menu button', { hasText: 'Move money out' }).click()
  await page.waitForTimeout(400)
  const selects = page.locator('.modal select')
  const vacationValue = await selects.nth(1).locator('option', { hasText: 'Vacation' }).getAttribute('value')
  await selects.nth(1).selectOption(vacationValue)
  await page.waitForTimeout(300)
  await page.locator('.modal input.amount').fill('100')
  await page.waitForTimeout(400)
  const moveBtn = page.locator('.modal-foot').getByRole('button', { name: /^Move/ })
  const label = await moveBtn.innerText()
  if (!label.includes('$100.00')) throw new Error(`move button said "${label}"`)
  await moveBtn.click()
  await page.waitForTimeout(700)
  const vac = page.locator('.cat-row', { hasText: 'Vacation' }).first()
  const avail = await vac.locator('.avail-pill').innerText()
  if (avail !== '$100.00') throw new Error(`Vacation available ${avail}`)
})

await step('scheduled transaction is created and listed', async () => {
  await addTransaction(page)
  await page.getByLabel('Amount', { exact: true }).fill('69.99')
  await page.getByLabel('Payee', { exact: true }).fill('Fibernet')
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Internet' })
  await page.getByLabel('Repeat', { exact: true }).selectOption('monthly')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('link', { name: 'Scheduled' }).first().click()
  await page.waitForTimeout(600)
  const text = await page.locator('.content').innerText()
  if (!text.includes('Fibernet') || !text.includes('Monthly')) throw new Error(JSON.stringify(text.slice(0, 500)))
})

await step('backup downloads and restores', async () => {
  await page.getByRole('link', { name: 'Settings' }).first().click()
  await page.waitForTimeout(400)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download' }).click(),
  ])
  const path = await download.path()
  const backup = JSON.parse(readFileSync(path, 'utf8'))
  if (backup.app !== 'enab') throw new Error('bad backup file')
  if (backup.transactions.length < 3) throw new Error(`only ${backup.transactions.length} transactions`)
  if (backup.accounts.length !== 1) throw new Error(`accounts ${backup.accounts.length}`)
  if (backup.scheduled.length !== 1) throw new Error(`scheduled ${backup.scheduled.length}`)

  // Wipe, then restore the file we just wrote.
  await page.getByRole('button', { name: 'Fresh start' }).click()
  await page.waitForTimeout(300)
  await page.locator('.modal').getByRole('button', { name: 'Delete everything' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('link', { name: 'All Accounts' }).first().click()
  await page.waitForTimeout(500)
  if (!(await page.locator('.content').innerText()).includes('No accounts yet')) {
    throw new Error('fresh start left data behind')
  }

  await page.getByRole('link', { name: 'Settings' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('input[type=file][accept*=json]').setInputFiles(path)
  await page.waitForTimeout(500)
  await page.locator('.modal').getByRole('button', { name: 'Restore' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('link', { name: 'All Accounts' }).first().click()
  await page.waitForTimeout(700)
  const accounts = await page.locator('.acct-list a').allInnerTexts()
  if (!accounts.some((a) => a.includes('Checking'))) throw new Error(`accounts after restore: ${accounts}`)
})

await step('restored budget numbers survive', async () => {
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(800)
  const vac = page.locator('.cat-row', { hasText: 'Vacation' }).first()
  const avail = await vac.locator('.avail-pill').innerText()
  if (avail !== '$100.00') throw new Error(`Vacation after restore: ${avail}`)
})

await browser.close()
finish(errors)
