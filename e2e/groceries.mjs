/**
 * Grocery list: add items the way people type them, tick them off, see the
 * list against the Groceries budget, and turn the cart into a transaction.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, createAccount, gotoSection, gotoBudget } from './harness.mjs'

const { browser, page, errors } = await launch({ device: 'iPhone 13' })

await step('set aside $100 for groceries', async () => {
  await page.goto(page.url().replace(/#.*$/, '') + '#/accounts')
  await page.waitForTimeout(500)
  await createAccount(page, { name: 'Checking', balance: '1000' })
  await gotoSection(page, 'Budget')
  const row = page.locator('.cat-row', { hasText: 'Groceries' }).first()
  await row.locator('input.assign-input').fill('100')
  await row.locator('input.assign-input').press('Enter')
  await page.waitForTimeout(400)
})

await step('the list lives quietly in the menu', async () => {
  await gotoSection(page, 'Grocery list')
  await page.getByText('Your list is empty').waitFor({ timeout: 3000 })
  const left = await page.locator('.groc-budget .left').innerText()
  if (left !== '$100.00 left') throw new Error(left)
})

async function addItem(text) {
  await page.getByLabel('Add an item').fill(text)
  await page.getByLabel('Add an item').press('Enter')
  await page.waitForTimeout(250)
}

await step('quick add reads quantities and prices', async () => {
  await addItem('2 lb chicken $8.99')
  await addItem('milk 3.49')
  await addItem('eggs')
  const rows = await page.locator('.groc-row').allInnerTexts()
  if (rows.length !== 3) throw new Error(`rows: ${rows}`)
  if (!rows[0].includes('Chicken') || !rows[0].includes('2 lb') || !rows[0].includes('$8.99')) throw new Error(rows[0])
  const line = await page.locator('.groc-budget .row2').innerText()
  if (!line.includes('$12.48') || !line.includes('1 unpriced') || !line.includes('$87.52 to spare')) throw new Error(line)
})

await step('ticking an item moves it to the cart', async () => {
  await page.getByRole('checkbox', { name: 'Chicken in cart' }).click()
  await page.waitForTimeout(250)
  const cart = await page.locator('.groc-cart').innerText()
  if (!cart.includes('Chicken') || !cart.includes('≈ $8.99')) throw new Error(cart)
  if ((await page.locator('.groc-list').first().locator('.groc-row').count()) !== 2) throw new Error('still listed')
})

await step('log this trip opens a pre-filled grocery transaction', async () => {
  await page.getByRole('button', { name: 'Log this trip' }).click()
  await page.waitForTimeout(400)
  const amount = await page.getByLabel('Amount', { exact: true }).inputValue()
  if (!amount.includes('8.99')) throw new Error(`amount ${amount}`)
  const category = await page.getByLabel('Category', { exact: true }).evaluate((s) => s.options[s.selectedIndex].text)
  if (!category.includes('Groceries')) throw new Error(`category ${category}`)
  await page.getByLabel('Amount', { exact: true }).fill('9.25')
  await page.getByLabel('Payee', { exact: true }).fill('Kroger')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(600)
  const left = await page.locator('.groc-budget .left').innerText()
  if (left !== '$90.75 left') throw new Error(left)
})

await step('clearing the cart can be undone', async () => {
  await page.getByRole('button', { name: 'Clear cart' }).click()
  await page.waitForTimeout(300)
  if (await page.locator('.groc-cart').count()) throw new Error('cart still shown')
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await page.waitForTimeout(300)
  if (!(await page.locator('.groc-cart').innerText()).includes('Chicken')) throw new Error('undo failed')
  await page.getByRole('button', { name: 'Clear cart' }).click()
  await page.waitForTimeout(300)
})

await step('a cleared item comes back from the usual items with its price', async () => {
  await page.locator('.groc-chip', { hasText: 'Chicken' }).click()
  await page.waitForTimeout(300)
  const row = await page.locator('.groc-row', { hasText: 'Chicken' }).innerText()
  if (!row.includes('$8.99') || !row.includes('2 lb')) throw new Error(row)
})

await step('editing an item', async () => {
  await page.locator('.groc-row', { hasText: 'Eggs' }).locator('.groc-body').click()
  await page.getByLabel('Quantity').fill('1 dozen')
  await page.getByLabel('Item price').fill('4.29')
  await page.locator('.modal').getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(400)
  const row = await page.locator('.groc-row', { hasText: 'Eggs' }).innerText()
  if (!row.includes('1 dozen') || !row.includes('$4.29')) throw new Error(row)
})

await step('nothing scrolls sideways on a phone', async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 0) throw new Error(`page is ${overflow}px too wide`)
})

await browser.close()
finish(errors)
