/**
 * Importing a bank's CSV on a phone: pick the file, check the summary, tap
 * Import — no column mapping. Covers a checking export (spending negative)
 * and a credit card export (spending positive), keeping the balance someone
 * typed in, and a second upload of the same file importing nothing.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, step, finish, createAccount, dismissInstallGuide } from './harness.mjs'

const dir = mkdtempSync(join(tmpdir(), 'enab-import-'))

/** `daysAgo` as the MM/DD/YYYY most US banks export. */
function us(daysAgo) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

// Chase checking's real layout: a "Details" column before the description,
// and a trailing comma on every row.
const checking = join(dir, 'Chase1234_Activity.CSV')
writeFileSync(
  checking,
  [
    'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    `DEBIT,${us(5)},"STARBUCKS STORE 12345 SEATTLE WA",-5.75,DEBIT_CARD,2400.00,,`,
    `CREDIT,${us(12)},"ACME CORP PAYROLL PPD ID: 1234567890",2400.00,ACH_CREDIT,2405.75,,`,
    `DEBIT,${us(20)},"Zelle payment to Jane Doe 12345",-60.00,QUICKPAY_DEBIT,5.75,,`,
  ].join('\r\n'),
)

// Amex's layout: charges are positive, the payment negative.
const card = join(dir, 'activity.csv')
writeFileSync(
  card,
  ['Date,Description,Amount', `${us(3)},WHOLE FOODS,84.12`, `${us(8)},AUTOPAY PAYMENT - THANK YOU,-200.00`, `${us(9)},SHELL OIL,41.30`].join('\n'),
)

const { browser, page, errors } = await launch({ device: 'iPhone 13' })
await dismissInstallGuide(page)

async function openImport() {
  await page.getByTitle('Account options').click()
  await page.getByRole('button', { name: 'Import from bank CSV' }).click()
  await page.waitForTimeout(300)
}

const summary = () => page.locator('.modal .card-pad').first().innerText()
const subtitle = () => page.locator('.topbar .subtitle').innerText()

await step('checking: a Chase export is read with no mapping', async () => {
  await createAccount(page, { name: 'Checking', balance: '2400' })
  await openImport()
  await page.locator('.modal input[type=file]').setInputFiles(checking)
  await page.waitForTimeout(400)
  const text = await summary()
  if (!text.includes('3 transactions')) throw new Error(`summary: ${text}`)
  // The payee is the description, not Chase's DEBIT/CREDIT column.
  const preview = await page.locator('.modal .list-row').allInnerTexts()
  if (!preview.some((r) => r.includes('STARBUCKS'))) throw new Error(`preview: ${preview.join(' | ')}`)
  if (preview.some((r) => /\bDEBIT\b/.test(r.split('\n')[1] ?? ''))) throw new Error('payee read from the Details column')
})

await step("checking: history before the account was added doesn't change its balance", async () => {
  const keep = page.getByRole('checkbox', { name: /Keep Checking’s balance/ })
  if (!(await keep.isChecked())) throw new Error('keep-balance should default on')
  if (!(await summary()).includes('balance after import: $2,400.00')) throw new Error(await summary())
  await page.locator('.modal-foot').getByRole('button', { name: 'Import 3' }).click()
  await page.waitForTimeout(800)
  if (!(await subtitle()).includes('$2,400.00')) throw new Error(`balance now ${await subtitle()}`)
  if ((await page.locator('.txn-row').count()) < 4) throw new Error('rows not in the register')
})

await step('checking: uploading the same file again imports nothing', async () => {
  await openImport()
  await page.locator('.modal input[type=file]').setInputFiles(checking)
  await page.waitForTimeout(400)
  if (!(await summary()).includes('All of them are already in Checking')) throw new Error(await summary())
  if (!(await page.locator('.modal-foot').getByRole('button', { name: 'Nothing new' }).isDisabled())) {
    throw new Error('import should be disabled')
  }
  await page.locator('.modal-foot').getByRole('button', { name: 'Cancel' }).click()
})

await step('card: charges written as positive numbers still import as spending', async () => {
  // On a phone, Add Account lives in the navigation drawer.
  await page.locator('.nav-menu-btn').click()
  await page.waitForTimeout(350)
  await createAccount(page, { name: 'Amex', type: 'creditCard', balance: '-500' })
  await openImport()
  await page.locator('.modal input[type=file]').setInputFiles(card)
  await page.waitForTimeout(400)
  if ((await page.getByRole('button', { name: /Positive/ }).getAttribute('aria-pressed')) !== 'true') {
    throw new Error('should have detected positive purchases')
  }
  const preview = await page.locator('.modal .list-row').allInnerTexts()
  const groceries = preview.find((r) => r.includes('WHOLE FOODS')) ?? ''
  if (!groceries.includes('-$84.12')) throw new Error(`groceries previewed as ${groceries.replace(/\n/g, ' ')}`)
  await page.locator('.modal-foot').getByRole('button', { name: /^Import \d/ }).click()
  await page.waitForTimeout(800)
  // All three predate the -$500 typed in today, so that balance already
  // includes them and must not move.
  if (!(await subtitle()).includes('-$500.00')) throw new Error(`card balance ${await subtitle()}`)
  const rows = await page.locator('.txn-row').allInnerTexts()
  const inRegister = rows.find((r) => r.includes('WHOLE FOODS')) ?? ''
  if (!inRegister.includes('-$84.12')) throw new Error(`register shows ${inRegister.replace(/\n/g, ' ')}`)
})

await browser.close()
finish(errors)
