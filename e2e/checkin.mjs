/**
 * Today, Search, and subscriptions paid from the budget — on a phone.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, createAccount, gotoSection, addTransaction } from './harness.mjs'

const { browser, page, errors } = await launch({ device: 'iPhone 13' })

async function spend({ payee, amount, category }) {
  await addTransaction(page)
  await page.getByLabel('Amount', { exact: true }).fill(amount)
  await page.getByLabel('Payee', { exact: true }).fill(payee)
  if (category) await page.getByLabel('Category', { exact: true }).selectOption({ label: category })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(500)
}

await step('a new budget asks for its money to be assigned', async () => {
  await page.goto(page.url().replace(/#.*$/, '') + '#/accounts')
  await page.waitForTimeout(500)
  await createAccount(page, { name: 'Checking', balance: '1000' })
  await gotoSection(page, 'Today')
  const rta = await page.locator('.rta-card').innerText()
  if (!rta.includes('$1,000.00 is waiting for a job')) throw new Error(rta)
})

await step('overspending and a missing category show up', async () => {
  await spend({ payee: 'Mystery Shop', amount: '25' })
  await spend({ payee: 'Taco Place', amount: '40', category: 'Eating Out' })
  await gotoSection(page, 'Today')
  const text = await page.locator('.today').innerText()
  if (!text.includes('Eating Out') || !text.includes('−$40.00')) throw new Error(`overspent: ${text}`)
  if (!/needs a category/i.test(text) || !text.includes('Mystery Shop')) throw new Error(`uncategorized: ${text}`)
  const badge = await page.locator('.sidebar .nav-badge').textContent()
  if (badge !== '3') throw new Error(`badge ${badge}`)
})

await step('categorizing from Today clears it', async () => {
  await page.locator('.today-row', { hasText: 'Mystery Shop' }).locator('select').selectOption({ label: 'Groceries' })
  await page.waitForTimeout(500)
  if (await page.locator('.today-row', { hasText: 'Mystery Shop' }).count()) throw new Error('still listed')
})

await step('search finds by payee and by amount, with a total', async () => {
  await page.locator('.nav-menu-btn').click()
  await page.waitForTimeout(350)
  await page.getByRole('link', { name: 'Search transactions' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('searchbox').fill('mystery')
  await page.waitForTimeout(400)
  let summary = await page.locator('.search-summary').innerText()
  if (!summary.includes('1 transaction') || !summary.includes('$25.00')) throw new Error(summary)
  await page.getByRole('searchbox').fill('>30')
  await page.waitForTimeout(400)
  const rows = await page.locator('.search-row').allInnerTexts()
  if (rows.length !== 2 || !rows.some((r) => r.includes('Taco Place'))) throw new Error(`rows: ${rows}`)
  await page.getByLabel('Spending or income').selectOption('spending')
  await page.waitForTimeout(400)
  summary = await page.locator('.search-summary').innerText()
  if (!summary.includes('1 transaction') || !summary.includes('$40.00')) throw new Error(summary)
})

async function addSub(name, price, cadence, month, day) {
  await page.locator('.topbar').getByRole('button', { name: 'Add', exact: true }).click()
  const m = page.locator('.modal')
  await m.getByPlaceholder('Netflix, Spotify, iCloud…').fill(name)
  await m.getByRole('button', { name: cadence, exact: true }).click()
  await m.getByRole('textbox', { name: 'Price' }).fill(price)
  if (month) await m.getByLabel('Billing month').selectOption(month)
  await m.getByLabel('Billing day').selectOption(day)
  await m.getByRole('button', { name: 'Add', exact: true }).click()
  await page.waitForTimeout(400)
}

await step('subscriptions can be paid from a category', async () => {
  await gotoSection(page, 'Subscriptions')
  await addSub('Claude', '22.99', 'Monthly', null, '30')
  await addSub('PlayStation Plus', '79.99', 'Yearly', '10', '14')
  await page.getByRole('button', { name: 'Fund them' }).click()
  await page.waitForTimeout(600)
  const card = await page.locator('.subs-fund').innerText()
  if (!card.includes('Paid from') || !card.includes('Subscriptions') || !card.includes('PlayStation Plus')) throw new Error(card)
  const assign = page.locator('.subs-fund').getByRole('button', { name: /^Assign / })
  await assign.click()
  await page.waitForTimeout(600)
  const after = await page.locator('.subs-fund').innerText()
  if (!/is set aside|already covered/.test(after)) throw new Error(after)
})

await step('the category shows the target that follows the subscriptions', async () => {
  await page.locator('.subs-fund .head .linkish').click()
  await page.waitForTimeout(500)
  const panel = await page.locator('.drawer').innerText()
  if (!panel.includes('Pays for 2 subscriptions')) throw new Error(panel)
})

await step('nothing scrolls sideways on a phone', async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  for (const section of ['Today', 'Subscriptions']) {
    await gotoSection(page, section)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    if (overflow > 0) throw new Error(`${section} is ${overflow}px too wide`)
  }
})

await browser.close()
finish(errors)
