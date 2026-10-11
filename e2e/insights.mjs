/**
 * Import rules, the cash-flow calendar and the month in review — on a phone.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, step, finish, createAccount, gotoSection } from './harness.mjs'

const dir = mkdtempSync(join(tmpdir(), 'enab-insights-'))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return iso(d)
}
// Paid on the 1st and 15th: the five most recent paydays.
const paydays = []
for (let n = 0; paydays.length < 5 && n < 120; n++) {
  const d = daysAgo(n)
  if (d.endsWith('-01') || d.endsWith('-15')) paydays.push(d)
}

const first = join(dir, 'first.csv')
writeFileSync(
  first,
  [
    'Date,Description,Amount',
    `${daysAgo(3)},SQ *BLUE BOTTLE 0423,-6.50`,
    `${daysAgo(9)},BLUE BOTTLE #12,-7.25`,
    `${daysAgo(4)},KROGER #432,-84.10`,
    `${daysAgo(11)},KROGER #518,-61.00`,
    ...paydays.map((d) => `${d},ACME CORP PAYROLL PPD ID 1234,2650.00`),
  ].join('\n'),
)
const second = join(dir, 'second.csv')
writeFileSync(second, ['Date,Description,Amount', `${daysAgo(1)},SQ *BLUE BOTTLE 7777,-5.90`].join('\n'))

const { browser, page, errors } = await launch({ device: 'iPhone 13' })

async function importFile(path) {
  await page.getByTitle('Account options').click()
  await page.getByRole('button', { name: 'Import from bank CSV' }).click()
  await page.waitForTimeout(300)
  await page.locator('.modal input[type=file]').setInputFiles(path)
  await page.waitForTimeout(500)
}

await step('import a bank file with messy names', async () => {
  await page.goto(page.url().replace(/#.*$/, '') + '#/accounts')
  await page.waitForTimeout(500)
  await createAccount(page, { name: 'Checking', balance: '3000' })
  await importFile(first)
  await page.locator('.modal-foot').getByRole('button', { name: /^Import \d+/ }).click()
  await page.waitForTimeout(800)
})

await step('rules are suggested from what came in', async () => {
  await gotoSection(page, 'Payees')
  await page.getByRole('tab', { name: /Import rules/ }).click()
  await page.waitForTimeout(300)
  const blue = page.locator('.rule-sug', { hasText: 'Blue Bottle' })
  const from = await blue.locator('.from').innerText()
  if (!from.includes('SQ *BLUE BOTTLE 0423') || !from.includes('BLUE BOTTLE #12')) throw new Error(from)
  await blue.getByRole('button', { name: 'Add' }).click()
  await page.waitForTimeout(500)
  if (!(await page.locator('.rule-row').innerText()).includes('Blue Bottle')) throw new Error('rule not listed')
  await page.getByRole('tab', { name: /^Payees/ }).click()
  const names = await page.locator('.list-row .truncate').allInnerTexts()
  if (!names.includes('Blue Bottle') || names.some((n) => n.includes('SQ *'))) throw new Error(`payees: ${names}`)
})

await step('the next import uses the rule', async () => {
  await gotoSection(page, 'Accounts')
  await page.locator('.acct-list a', { hasText: 'Checking' }).first().click()
  await page.waitForTimeout(500)
  await importFile(second)
  const preview = await page.locator('.modal .list-row').first().innerText()
  if (!preview.includes('Blue Bottle') || !preview.includes('rule')) throw new Error(preview)
  await page.locator('.modal-foot').getByRole('button', { name: /^Import \d+/ }).click()
  await page.waitForTimeout(800)
  const rows = await page.locator('.txn-row', { hasText: 'Blue Bottle' }).count()
  if (rows !== 3) throw new Error(`${rows} Blue Bottle rows`)
})

await step('cash flow spots the paycheck and forecasts with it', async () => {
  await gotoSection(page, 'Cash flow')
  await page.waitForTimeout(500)
  const card = page.locator('.cal-income')
  const text = await card.innerText()
  if (!text.includes('Acme Corp Payroll') || !text.includes('$2,650.00')) throw new Error(text)
  await card.getByRole('button', { name: 'Add it' }).click()
  await page.waitForTimeout(600)
  if (await page.locator('.cal-income').count()) throw new Error('paycheck still offered')
  if (!(await page.locator('.cal-status').innerText()).match(/stays above|dips to|negative/)) throw new Error('no status')
  // Tap a payday in view and see it listed.
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.locator('.cal-day', { hasText: /^15/ }).first().click()
  const detail = await page.locator('.cal-detail').innerText()
  if (!detail.includes('ACME CORP PAYROLL') || !detail.includes('projected')) throw new Error(detail)
})

await step('the month in review opens from Reports', async () => {
  await gotoSection(page, 'Reports')
  await page.getByRole('link', { name: /review/ }).click()
  await page.waitForTimeout(600)
  const hero = await page.locator('.review-hero').innerText()
  if (!hero.includes('Came in') || !hero.includes('Went out')) throw new Error(hero)
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.waitForTimeout(400)
  if (!(await page.locator('.review .so-far').count())) throw new Error('current month not marked as so far')
})

await step('nothing scrolls sideways on a phone', async () => {
  for (const section of ['Cash flow', 'Payees']) {
    await gotoSection(page, section)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 0) throw new Error(`${section} is ${overflow}px too wide`)
  }
})

await browser.close()
finish(errors)
