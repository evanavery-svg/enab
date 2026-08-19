/**
 * Phone behaviour that is easy to break and hard to notice: the app shell
 * staying put while a list scrolls, and form fields never dipping under the
 * size that makes iOS Safari zoom the page in.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish } from './harness.mjs'

const { browser, page, errors } = await launch({ device: 'iPhone 13' })

/** Every visible text field, with its rendered size. */
async function undersizedFields() {
  return page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .filter(
        (el) =>
          !['checkbox', 'radio', 'file', 'hidden'].includes(el.type) && el.offsetParent !== null,
      )
      .map((el) => ({
        control: `${el.tagName.toLowerCase()}.${el.className || '(none)'}`,
        size: parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter((entry) => entry.size < 16),
  )
}

await step('set up an account', async () => {
  await page.getByRole('button', { name: 'Add your first account' }).click()
  await page.getByLabel('Account name').fill('Checking')
  await page.getByLabel("Today's balance").fill('4800')
  await page.getByRole('button', { name: 'Create Account' }).click()
  await page.waitForTimeout(900)
  await page.locator('.bottom-nav a', { hasText: 'Budget' }).click()
  await page.waitForTimeout(700)
})

await step('the shell is pinned so the page can never scroll', async () => {
  // Asserting the mechanism, not just today's outcome: a desktop browser will
  // not reproduce iOS Safari collapsing its URL bar, so measuring "does it
  // scroll right now" would pass even with the bug present. Forcing content
  // past the viewport proves the document cannot scroll whatever is in it.
  const result = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'height:5000px;width:1px'
    probe.id = 'scroll-probe'
    document.body.appendChild(probe)

    window.scrollTo(0, 3000)
    const outcome = {
      position: getComputedStyle(document.body).position,
      overflow: getComputedStyle(document.body).overflow,
      documentScrollable:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
      scrolled: window.scrollY,
    }
    probe.remove()
    return outcome
  })

  if (result.position !== 'fixed') throw new Error(`body is position: ${result.position}, expected fixed`)
  if (result.overflow !== 'hidden') throw new Error(`body overflow is ${result.overflow}, expected hidden`)
  if (result.documentScrollable) throw new Error('the document grew scrollable when content overflowed')
  if (result.scrolled !== 0) throw new Error(`the window scrolled to ${result.scrolled}`)
})

await step('header and tab bar hold still while the list scrolls', async () => {
  const topBefore = await page.locator('.topbar').boundingBox()
  const navBefore = await page.locator('.bottom-nav').boundingBox()

  await page.locator('.content').evaluate((el) => el.scrollTo(0, 1400))
  await page.waitForTimeout(500)

  const scrolled = await page.locator('.content').evaluate((el) => el.scrollTop)
  if (scrolled < 100) throw new Error(`the list barely scrolled (${scrolled}px) — test is not exercising it`)

  const topAfter = await page.locator('.topbar').boundingBox()
  const navAfter = await page.locator('.bottom-nav').boundingBox()
  if (topBefore.y !== topAfter.y) throw new Error(`header moved ${topBefore.y} -> ${topAfter.y}`)
  if (navBefore.y !== navAfter.y) throw new Error(`tab bar moved ${navBefore.y} -> ${navAfter.y}`)
  if ((await page.evaluate(() => window.scrollY)) !== 0) throw new Error('the window scrolled')
})

await step('no field on the budget screen would trigger iOS zoom', async () => {
  const small = await undersizedFields()
  if (small.length) throw new Error(`under 16px: ${JSON.stringify(small)}`)
})

await step('a long assigned amount still fits its column', async () => {
  const row = page.locator('.cat-row', { hasText: 'Rent/Mortgage' }).first()
  const input = row.locator('input.assign-input')
  await input.fill('1500')
  await input.press('Enter')
  await page.waitForTimeout(500)
  const clipped = await input.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  if (clipped) throw new Error(`"${await input.inputValue()}" is clipped in the assigned column`)
})

await step('no field in the transaction sheet would trigger iOS zoom', async () => {
  await page.locator('.fab').click()
  await page.waitForTimeout(700)
  const small = await undersizedFields()
  if (small.length) throw new Error(`under 16px: ${JSON.stringify(small)}`)
  await page.locator('.modal-head .icon-btn').click()
  await page.waitForTimeout(400)
})

await step('no field in the register would trigger iOS zoom', async () => {
  await page.locator('.bottom-nav a', { hasText: 'Accounts' }).click()
  await page.waitForTimeout(600)
  await page.locator('.acct-list a').first().click()
  await page.waitForTimeout(700)
  const small = await undersizedFields()
  if (small.length) throw new Error(`under 16px: ${JSON.stringify(small)}`)
})

await step('the add button never covers a bulk action bar', async () => {
  await page.locator('.bottom-nav a', { hasText: 'More' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('link', { name: 'Auto-Budget' }).click()
  await page.waitForTimeout(900)
  // The Auto-Budget screen always shows its action bar once there is history;
  // with none, there is no bar and the add button is free to show.
  const barVisible = await page.locator('.bulk-bar').isVisible().catch(() => false)
  const fabVisible = await page.locator('.fab').isVisible().catch(() => false)
  if (barVisible && fabVisible) throw new Error('the add button is sitting on top of the action bar')
})

await browser.close()
finish(errors)
