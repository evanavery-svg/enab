/**
 * Phone behaviour: the flush bottom tab bar sitting on the true bottom edge,
 * the header and bar staying put while the list scrolls, and form fields never
 * dipping under the 16px that makes iOS Safari zoom the page in.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, addTransaction, gotoSection } from './harness.mjs'

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
  await gotoSection(page, 'Budget')
})

await step('the tab bar sits flush on the true bottom edge', async () => {
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.bottom-nav')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      visible: getComputedStyle(el).display !== 'none',
      // The whole point of the rebuild: the bar's bottom edge lands on the
      // viewport's bottom edge, with no band of dead space beneath it.
      bottomGap: Math.round(window.innerHeight - r.bottom),
      spansWidth: Math.round(r.width) >= Math.round(window.innerWidth) - 1,
      atBottomHalf: r.top > window.innerHeight / 2,
    }
  })
  if (!bar || !bar.visible) throw new Error('the bottom tab bar is not visible on a phone')
  if (Math.abs(bar.bottomGap) > 2) throw new Error(`the bar is ${bar.bottomGap}px off the bottom edge`)
  if (!bar.spansWidth) throw new Error('the bar does not span the full width')
  if (!bar.atBottomHalf) throw new Error('the bar is not at the bottom of the screen')
})

await step('the header sits on the true top edge', async () => {
  const top = await page.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().top))
  if (top !== 0) throw new Error(`the header starts at ${top}px, not the top edge`)
})

await step('the page itself cannot scroll', async () => {
  const scrollable = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'height:4000px;width:1px'
    document.body.appendChild(probe)
    window.scrollTo(0, 2000)
    const out = {
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      documentScrolled: window.scrollY,
      documentScrollable:
        document.documentElement.scrollHeight > document.documentElement.clientHeight,
    }
    probe.remove()
    return out
  })
  if (scrollable.htmlOverflow !== 'hidden') throw new Error(`html overflow is ${scrollable.htmlOverflow}`)
  if (scrollable.documentScrolled !== 0) throw new Error(`the window scrolled to ${scrollable.documentScrolled}`)
  if (scrollable.documentScrollable) throw new Error('the document grew scrollable')
})

await step('the header and tab bar hold still while the list scrolls', async () => {
  const topBefore = await page.locator('.topbar').boundingBox()
  const barBefore = await page.locator('.bottom-nav').boundingBox()
  await page.locator('.content').evaluate((el) => el.scrollTo(0, 1400))
  await page.waitForTimeout(400)
  const scrolled = await page.locator('.content').evaluate((el) => el.scrollTop)
  if (scrolled < 100) throw new Error(`the list barely scrolled (${scrolled}px)`)
  const topAfter = await page.locator('.topbar').boundingBox()
  const barAfter = await page.locator('.bottom-nav').boundingBox()
  if (topBefore.y !== topAfter.y) throw new Error(`header moved ${topBefore.y} -> ${topAfter.y}`)
  if (barBefore.y !== barAfter.y) throw new Error(`tab bar moved ${barBefore.y} -> ${barAfter.y}`)
})

await step('the bar carries every primary tab', async () => {
  const items = await page.locator('.bottom-nav-item').allInnerTexts()
  for (const expected of ['Budget', 'Accounts', 'Auto-Budget', 'Reports', 'More']) {
    if (!items.some((t) => t.includes(expected))) throw new Error(`tab bar missing ${expected}`)
  }
  // Budget is the current section, so its tab is marked.
  const active = await page.locator('.bottom-nav-item.active').innerText()
  if (!active.includes('Budget')) throw new Error(`active tab was "${active}", expected Budget`)
})

await step('tapping a tab changes the page', async () => {
  await page.locator('.bottom-nav-item', { hasText: 'Accounts' }).click()
  await page.waitForTimeout(600)
  const active = await page.locator('.bottom-nav-item.active').innerText()
  if (!active.includes('Accounts')) throw new Error(`active tab was "${active}" after navigating`)
})

await step('the More tab opens the overflow sheet', async () => {
  await page.locator('.bottom-nav-item', { hasText: 'More' }).click()
  await page.waitForTimeout(400)
  if (!(await page.locator('.navsheet').isVisible())) throw new Error('the More sheet did not open')
  const items = await page.locator('.navsheet-item').allInnerTexts()
  for (const expected of ['Scheduled', 'Payees', 'Settings']) {
    if (!items.some((t) => t.includes(expected))) throw new Error(`More sheet missing ${expected}`)
  }
  if (!(await page.locator('.navsheet-add').isVisible())) throw new Error('New Transaction missing from the More sheet')
  // Close it again.
  await page.locator('.navsheet-scrim').click({ position: { x: 10, y: 10 } })
  await page.waitForTimeout(300)
})

await step('adding a transaction opens the sheet with no zoom-triggering field', async () => {
  await gotoSection(page, 'Budget')
  await addTransaction(page)
  await page.waitForTimeout(500)
  if (!(await page.locator('.modal').isVisible())) throw new Error('the transaction modal did not open')
  const small = await undersizedFields()
  if (small.length) throw new Error(`fields under 16px in the transaction sheet: ${JSON.stringify(small)}`)
  await page.locator('.modal-head .icon-btn').click()
  await page.waitForTimeout(300)
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

await browser.close()
finish(errors)
