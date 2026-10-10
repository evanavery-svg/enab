/**
 * Auto-Budget — importing history, finding recurring charges, and turning
 * them into a plan.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish } from './harness.mjs'

const { browser, page, errors } = await launch()

/**
 * The six completed months before this one. The amounts below are fixed so
 * every assertion is exact, but the dates have to move with the calendar:
 * hard-coded months eventually drift far enough into the past that the
 * detector correctly calls every subscription lapsed, and the suite fails for
 * a reason that has nothing to do with the code under test.
 */
function recentMonths(count = 6) {
  const now = new Date()
  const out = []
  for (let i = count; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/* Deliberately fixed, not random, so every assertion below is exact:
   fixed subscriptions, a variable bill, irregular shopping, one splurge,
   and one subscription that was cancelled. */
function buildCsv() {
  const rows = [['Date', 'Description', 'Category', 'Outflow', 'Inflow']]
  const add = (d, p, c, out, inn = '') => rows.push([d, p, c, out, inn])
  const months = recentMonths(6)
  const electric = [88.4, 121.35, 96.1, 110.75, 92.2, 104.6]
  const groceryTotals = [420, 435, 410, 428, 415, 422]

  months.forEach((m, i) => {
    add(`${m}-01`, 'Acme Corp', 'Ready to Assign', '', '3000.00')
    add(`${m}-02`, 'Landlord', 'Rent/Mortgage', '1500.00')
    add(`${m}-12`, 'Streamly', 'Subscriptions', '17.99')
    add(`${m}-18`, 'Cloud Drive', 'Subscriptions', '9.99')
    add(`${m}-05`, 'City Power', 'Electric', electric[i].toFixed(2))
    // Four irregular grocery trips a month, summing to the month's total.
    const shares = [0.3, 0.25, 0.25, 0.2]
    ;['03', '11', '19', '27'].forEach((day, k) =>
      add(`${m}-${day}`, 'Green Grocer', 'Groceries', (groceryTotals[i] * shares[k]).toFixed(2)),
    )
  })
  // Cancelled after the first three months.
  for (const m of months.slice(0, 3)) add(`${m}-25`, 'Old Magazine', 'Subscriptions', '12.50')
  // A one-off that must not set the grocery budget.
  add(`${months[3]}-16`, 'Green Grocer', 'Groceries', '600.00')

  return rows.map((r) => r.join(',')).join('\n')
}

await step('set up an account', async () => {
  await page.getByRole('button', { name: 'Add your first account' }).click()
  await page.getByLabel('Account name').fill('Checking')
  await page.getByLabel("Today's balance").fill('2000')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.waitForTimeout(800)
})

await step('Auto-Budget invites an import when there is no history', async () => {
  await page.getByRole('link', { name: 'Auto-Budget' }).first().click()
  await page.waitForTimeout(700)
  const heading = await page.locator('.empty h3').innerText()
  if (!heading.includes('Nothing to learn from')) throw new Error(`empty state said "${heading}"`)
})

await step('import history from the Auto-Budget page', async () => {
  await page.locator('.topbar').getByRole('button', { name: 'Import CSV' }).click()
  await page.waitForTimeout(400)
  await page.getByText('Or paste the rows instead').click()
  await page.getByLabel('…or paste the rows').fill(buildCsv())
  await page.waitForTimeout(700)
  await page.locator('.modal-foot').getByRole('button', { name: /^Import/ }).click()
  await page.waitForTimeout(9000)
  const learned = await page.locator('.acct-summary .stat').first().innerText()
  if (!learned.includes('6 months')) throw new Error(`learned from: ${learned.replace(/\n/g, ' ')}`)
})

await step('finds the fixed subscriptions and their real cost', async () => {
  const rows = await page.locator('.sub-list li').allInnerTexts()
  const names = rows.map((r) => r.split('\n')[0])
  for (const expected of ['Landlord', 'Streamly', 'Cloud Drive']) {
    if (!names.includes(expected)) throw new Error(`missing ${expected}; found ${names.join(', ')}`)
  }
  const streamly = rows.find((r) => r.startsWith('Streamly'))
  if (!streamly.includes('$17.99') || !streamly.includes('Monthly')) {
    throw new Error(`Streamly row: ${streamly.replace(/\n/g, ' | ')}`)
  }
})

await step('does not mistake irregular shopping for a subscription', async () => {
  const names = (await page.locator('.sub-list li').allInnerTexts()).map((r) => r.split('\n')[0])
  if (names.includes('Green Grocer')) throw new Error('grocery trips were flagged as recurring')
  // A bill that changes every month is regular but is not a fixed subscription.
  if (names.includes('City Power')) throw new Error('a variable bill was flagged as a subscription')
})

await step('separates subscriptions that stopped charging', async () => {
  const toggle = page.locator('.plan-inactive button')
  const label = await toggle.innerText()
  if (!label.includes('1 that stopped charging')) throw new Error(`lapsed section said "${label}"`)
  await toggle.click()
  await page.waitForTimeout(300)
  const text = await page.locator('.plan-inactive').innerText()
  if (!text.includes('Old Magazine')) throw new Error('cancelled subscription not listed')
})

await step('plans from a typical month, ignoring the splurge', async () => {
  const row = page.locator('.plan-list li', { hasText: 'Groceries' }).first()
  const amount = await row.locator('input.amount').inputValue()
  // Monthly grocery totals sit around $420; the $600 one-off must not lift it.
  const value = Number(amount.replace(/[^0-9.]/g, ''))
  if (!(value > 400 && value < 460)) throw new Error(`groceries suggested ${amount}`)
  if (!(await row.locator('.meta').innerText()).includes('Typical')) {
    throw new Error('groceries were not planned from history')
  }
})

await step('excluding a category removes it from the total', async () => {
  const before = await page.locator('.bulk-bar .btn-primary').innerText()
  await page.locator('.plan-list li', { hasText: 'Groceries' }).first().locator('input[type=checkbox]').uncheck()
  await page.waitForTimeout(400)
  const after = await page.locator('.bulk-bar .btn-primary').innerText()
  if (before === after) throw new Error('total did not change when a category was excluded')
  await page.locator('.plan-list li', { hasText: 'Groceries' }).first().locator('input[type=checkbox]').check()
  await page.waitForTimeout(400)
})

await step('applying the plan assigns the budget', async () => {
  await page.locator('.bulk-bar .btn-primary').click()
  await page.waitForTimeout(1600)
  await page.getByRole('link', { name: /^Budget/ }).first().click()
  await page.waitForTimeout(1000)

  const rent = page.locator('.cat-row', { hasText: 'Rent/Mortgage' }).first()
  const assigned = await rent.locator('input.assign-input').inputValue()
  if (!assigned.includes('1,500')) throw new Error(`rent assigned ${assigned}`)
})

await step('a subscription can be pushed into Scheduled', async () => {
  await page.getByRole('link', { name: 'Auto-Budget' }).first().click()
  await page.waitForTimeout(900)
  const row = page.locator('.sub-list li', { hasText: 'Streamly' }).first()
  await row.getByRole('button', { name: 'Schedule' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('link', { name: 'Scheduled' }).first().click()
  await page.waitForTimeout(700)
  const text = await page.locator('.content').innerText()
  if (!text.includes('Streamly') || !text.includes('Monthly')) {
    throw new Error(`scheduled page: ${text.slice(0, 160)}`)
  }
})

await browser.close()
finish(errors)
