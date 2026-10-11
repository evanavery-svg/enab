/**
 * Subscriptions: add a few, read the monthly and yearly totals, cancel one
 * and watch it move to the savings side.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, gotoSection, BASE_URL } from './harness.mjs'

const { browser, page, errors } = await launch({ device: 'iPhone 13' })

async function addSub({ name, price, cadence = 'Monthly', month, day, through, unknown = false }) {
  await page.locator('.topbar').getByRole('button', { name: 'Add', exact: true }).click()
  const sheet = page.locator('.modal')
  await sheet.getByPlaceholder('Netflix, Spotify, iCloud…').fill(name)
  await sheet.getByRole('button', { name: cadence, exact: true }).click()
  if (unknown) await sheet.getByLabel("I don't know the price").check()
  else await sheet.getByRole('textbox', { name: 'Price' }).fill(price)
  if (month) await sheet.getByLabel('Billing month').selectOption(month)
  if (day) await sheet.getByLabel('Billing day').selectOption(day)
  if (through) await sheet.getByLabel('Billed through').fill(through)
  await sheet.getByRole('button', { name: 'Add', exact: true }).click()
  await page.waitForTimeout(400)
}

await step('open Subscriptions from the menu', async () => {
  await page.goto(BASE_URL + '#/accounts', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await gotoSection(page, 'Subscriptions')
  await page.getByText('Track what you pay for').waitFor({ timeout: 3000 })
})

await step('add a monthly, a yearly and one without a price', async () => {
  await addSub({ name: 'Claude', price: '22.99', day: '30', through: 'Apple' })
  await addSub({ name: 'PlayStation Plus', price: '79.99', cadence: 'Yearly', month: '10', day: '14', through: 'PayPal' })
  await addSub({ name: 'YouTube Premium', unknown: true })
  const rows = await page.locator('.sub-row').count()
  if (rows !== 3) throw new Error(`expected 3 rows, got ${rows}`)
})

await step('the hero adds them up per month and per year', async () => {
  const hero = await page.locator('.subs-hero.spend').innerText()
  for (const want of ['$29.66', '$355.87 a year', '2 subscriptions', 'YouTube Premium']) {
    if (!hero.includes(want)) throw new Error(`hero missing "${want}": ${hero.replace(/\n/g, ' | ')}`)
  }
})

await step('a yearly plan shows its monthly share', async () => {
  const row = await page.locator('.sub-row', { hasText: 'PlayStation Plus' }).innerText()
  if (!row.includes('$79.99') || !row.includes('$6.67/mo') || !row.includes('Oct 14')) {
    throw new Error(row.replace(/\n/g, ' | '))
  }
})

await step('cancelling moves it to the savings side', async () => {
  await page.locator('.sub-row', { hasText: 'Claude' }).click()
  await page.locator('.modal').getByRole('button', { name: 'Mark cancelled' }).click()
  await page.waitForTimeout(400)
  const hero = await page.locator('.subs-hero.spend').innerText()
  if (!hero.includes('$6.67')) throw new Error(`active total after cancel: ${hero}`)

  await page.getByRole('tab', { name: /Cancelled/ }).click()
  const saving = await page.locator('.subs-hero.saving').innerText()
  if (!saving.includes('$22.99') || !saving.includes('$275.88 a year')) throw new Error(saving.replace(/\n/g, ' | '))
  const row = await page.locator('.sub-row.cancelled').innerText()
  if (!row.includes('+$22.99')) throw new Error(row)
})

await step('resubscribe brings it back', async () => {
  await page.locator('.sub-row', { hasText: 'Claude' }).click()
  await page.locator('.modal').getByRole('button', { name: 'Resubscribe' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: /Active/ }).click()
  const hero = await page.locator('.subs-hero.spend').innerText()
  if (!hero.includes('$29.66')) throw new Error(hero)
})

await step('nothing scrolls sideways on a phone', async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 0) throw new Error(`page is ${overflow}px too wide`)
})

await browser.close()
finish(errors)
