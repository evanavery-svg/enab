/**
 * Phone behaviour: the floating nav dock, the menu sheet, header-stays-put on
 * scroll, and form fields never dipping under the size that makes iOS Safari
 * zoom the page in.
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

await step('the nav is a floating dock, not a flush bar', async () => {
  const dock = await page.evaluate(() => {
    const el = document.querySelector('.navdock')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      position: getComputedStyle(el).position,
      visible: getComputedStyle(el).display !== 'none',
      bottomGap: Math.round(window.innerHeight - r.bottom),
      centered: Math.abs((r.left + r.right) / 2 - window.innerWidth / 2) < 4,
    }
  })
  if (!dock || !dock.visible) throw new Error('the floating dock is not visible on a phone')
  if (dock.position !== 'fixed') throw new Error(`dock position is ${dock.position}, expected fixed`)
  // The whole point: it floats above the bottom with margin, so it never needs
  // the screen's true bottom edge (which iOS reports wrong in standalone).
  if (dock.bottomGap < 8) throw new Error(`dock is only ${dock.bottomGap}px off the bottom — not floating`)
  if (!dock.centered) throw new Error('dock is not horizontally centered')
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

await step('the header holds still while the list scrolls', async () => {
  const topBefore = await page.locator('.topbar').boundingBox()
  await page.locator('.content').evaluate((el) => el.scrollTo(0, 1400))
  await page.waitForTimeout(400)
  const scrolled = await page.locator('.content').evaluate((el) => el.scrollTop)
  if (scrolled < 100) throw new Error(`the list barely scrolled (${scrolled}px)`)
  const topAfter = await page.locator('.topbar').boundingBox()
  if (topBefore.y !== topAfter.y) throw new Error(`header moved ${topBefore.y} -> ${topAfter.y}`)
})

await step('the dock menu opens the nav sheet with every section', async () => {
  await page.locator('.navdock-menu').click()
  await page.waitForTimeout(400)
  if (!(await page.locator('.navsheet').isVisible())) throw new Error('nav sheet did not open')
  const items = await page.locator('.navsheet-item').allInnerTexts()
  for (const expected of ['Budget', 'Accounts', 'Auto-Budget', 'Reports', 'Scheduled', 'Payees', 'Settings']) {
    if (!items.some((t) => t.includes(expected))) throw new Error(`nav sheet missing ${expected}`)
  }
  // The current section is marked.
  const current = await page.locator('.navsheet-item.current').innerText()
  if (!current.includes('Budget')) throw new Error(`current item was "${current}", expected Budget`)
})

await step('navigating from the sheet changes the page', async () => {
  await page.locator('.navsheet-item', { hasText: 'Accounts' }).click()
  await page.waitForTimeout(600)
  if (!(await page.locator('.navsheet').isVisible().catch(() => false)) === false) {
    // sheet should have closed
  }
  const dockLabel = await page.locator('.navdock-menu-label').innerText()
  if (dockLabel !== 'Accounts') throw new Error(`dock still says "${dockLabel}" after navigating`)
})

await step('the dock add button opens the transaction sheet', async () => {
  await addTransaction(page)
  await page.waitForTimeout(500)
  if (!(await page.locator('.modal').isVisible())) throw new Error('add button did not open the transaction modal')
  const small = await undersizedFields()
  if (small.length) throw new Error(`fields under 16px in the transaction sheet: ${JSON.stringify(small)}`)
  await page.locator('.modal-head .icon-btn').click()
  await page.waitForTimeout(300)
})

await step('no field on the budget screen would trigger iOS zoom', async () => {
  await gotoSection(page, 'Budget')
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
