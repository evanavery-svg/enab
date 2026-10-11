/**
 * First run, the way it should go: open the app, start from the bank's CSV,
 * see the payees sorted into categories, fix one, get a suggested budget,
 * assign it. No manual column mapping, no typing categories one by one.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, step, finish, dismissInstallGuide } from './harness.mjs'

/** `YYYY-MM-DD` for day `d` of the month `back` months ago — completed months only. */
function on(back, d) {
  const now = new Date()
  const m = new Date(now.getFullYear(), now.getMonth() - back, d)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`
}

const dir = mkdtempSync(join(tmpdir(), 'enab-setup-'))
const file = join(dir, 'Chase1234_Activity.CSV')
const rows = ['Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #']
for (const back of [3, 2, 1]) {
  rows.push(`CREDIT,${on(back, 1)},"ACME CORP DES:PAYROLL",3000.00,ACH_CREDIT,0,,`)
  rows.push(`DEBIT,${on(back, 2)},"LANDLORD PROPERTIES",-1500.00,ACH_DEBIT,0,,`)
  rows.push(`DEBIT,${on(back, 6)},"WHOLEFDS MKT 10234",-180.40,DEBIT_CARD,0,,`)
  rows.push(`DEBIT,${on(back, 14)},"WHOLEFDS MKT 10234",-162.10,DEBIT_CARD,0,,`)
  rows.push(`DEBIT,${on(back, 9)},"SHELL OIL 57444",-48.00,DEBIT_CARD,0,,`)
  rows.push(`DEBIT,${on(back, 12)},"NETFLIX.COM",-17.99,DEBIT_CARD,0,,`)
  rows.push(`DEBIT,${on(back, 18)},"MYSTERY SHOP 44",-60.00,DEBIT_CARD,0,,`)
}
writeFileSync(file, rows.join('\r\n'))

const { browser, page, errors } = await launch({ device: 'iPhone 13' })
await dismissInstallGuide(page)

await step('the welcome screen leads with the bank file', async () => {
  await page.getByRole('button', { name: /Start from my bank's CSV/ }).click()
  await page.waitForTimeout(400)
  await page.getByLabel('Account name').fill('Checking')
  await page.locator('input.amount').fill('2400')
})

await step('the file imports with no mapping and lands on the category check', async () => {
  await page.getByRole('button', { name: 'Next: pick the file' }).click()
  await page.locator('.modal input[type=file]').waitFor()
  await page.locator('.modal input[type=file]').setInputFiles(file)
  await page.waitForTimeout(500)
  await page.locator('.modal-foot').getByRole('button', { name: /^Import 21/ }).click()
  await page.locator('.review-list').waitFor({ timeout: 8000 })
})

const chosen = (payee) =>
  page.locator('.review-row', { hasText: payee }).locator('select option:checked').innerText()

await step('payees were sorted from their names, and the unknown one is flagged', async () => {
  if ((await chosen('WHOLEFDS')) !== 'Groceries') throw new Error(`Whole Foods → ${await chosen('WHOLEFDS')}`)
  if ((await chosen('SHELL')) !== 'Transportation') throw new Error(`Shell → ${await chosen('SHELL')}`)
  if ((await chosen('NETFLIX')) !== 'Subscriptions') throw new Error(`Netflix → ${await chosen('NETFLIX')}`)
  if ((await chosen('LANDLORD')) !== 'Rent/Mortgage') throw new Error(`Landlord → ${await chosen('LANDLORD')}`)
  if ((await chosen('ACME')) !== 'Ready to Assign') throw new Error(`Payroll → ${await chosen('ACME')}`)
  const mystery = page.locator('.review-row', { hasText: 'MYSTERY' })
  if (!(await mystery.getAttribute('class')).includes('needs')) throw new Error('unknown payee not flagged')
  // Unknowns come first, so the eye lands on what needs a decision.
  const first = await page.locator('.review-row').first().innerText()
  if (!first.includes('MYSTERY')) throw new Error(`first row is ${first.split('\n')[0]}`)
})

await step('fixing one payee applies to all of its transactions', async () => {
  await page.locator('.review-row', { hasText: 'MYSTERY' }).locator('select').selectOption({ label: 'Hobbies' })
  await page.waitForTimeout(500)
  const sub = await page.locator('.topbar .subtitle').innerText()
  if (!sub.startsWith('6 of 6')) throw new Error(`subtitle: ${sub}`)
})

await step('next is a suggested budget built from the history', async () => {
  await page.getByRole('button', { name: /Next: suggest my budget/ }).click()
  await page.locator('.plan-list').waitFor({ timeout: 8000 })
  const groceries = page.locator('.plan-list li', { hasText: 'Groceries' }).first()
  const amount = await groceries.locator('input.amount').inputValue()
  // Two trips a month, ~$342, rounded up to a whole dollar.
  if (!amount.includes('343')) throw new Error(`groceries suggested ${amount}`)
  const hobbies = await page.locator('.plan-list li', { hasText: 'Hobbies' }).first().locator('input.amount').inputValue()
  if (!hobbies.includes('60')) throw new Error(`hobbies suggested ${hobbies}`)
})

await step('adjusting a suggestion and assigning lands on the budget', async () => {
  const groceries = page.locator('.plan-list li', { hasText: 'Groceries' }).first().locator('input.amount')
  await groceries.fill('400')
  await groceries.press('Tab')
  await page.waitForTimeout(300)
  const shown = await groceries.inputValue()
  if (!shown.includes('400')) throw new Error(`field shows ${shown} after editing`)
  const bar = await page.locator('.bulk-bar .btn-primary').innerText()
  // 1,969 suggested, Groceries 343 → 400.
  if (!bar.includes('2,026')) throw new Error(`assign button says "${bar}" — override not in the total`)
  await page.locator('.bulk-bar .btn-primary').click()
  await page.locator('.rta-amount').waitFor({ timeout: 8000 })
  const row = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  const assigned = await row.locator('input.assign-input').inputValue()
  if (!assigned.includes('400')) throw new Error(`groceries assigned ${assigned}`)
  const netflix = await page.locator('.cat-row', { hasText: 'Subscriptions' }).first().locator('input.assign-input').inputValue()
  if (!netflix.includes('18')) throw new Error(`subscriptions assigned ${netflix}`)
})

await browser.close()
finish(errors)
