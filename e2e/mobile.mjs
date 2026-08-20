/**
 * Phone behaviour: the slide-in navigation drawer, a header pinned to the true
 * top edge, content reaching the true bottom edge with no bottom chrome, and
 * form fields never dipping under the 16px that makes iOS Safari zoom the page.
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

await step('there is no bottom chrome — content reaches the true bottom edge', async () => {
  const shell = await page.evaluate(() => {
    const content = document.querySelector('.content')
    const r = content.getBoundingClientRect()
    return {
      hasBottomBar: !!document.querySelector('.bottom-nav'),
      // The scroll area runs all the way to the bottom of the viewport, so
      // nothing hangs off a wrongly-measured bottom edge.
      contentBottomGap: Math.round(window.innerHeight - r.bottom),
    }
  })
  if (shell.hasBottomBar) throw new Error('a bottom bar is still present')
  if (Math.abs(shell.contentBottomGap) > 2)
    throw new Error(`content stops ${shell.contentBottomGap}px short of the bottom edge`)
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

await step('the header holds still while the list scrolls', async () => {
  const topBefore = await page.locator('.topbar').boundingBox()
  await page.locator('.content').evaluate((el) => el.scrollTo(0, 1400))
  await page.waitForTimeout(400)
  const scrolled = await page.locator('.content').evaluate((el) => el.scrollTop)
  if (scrolled < 100) throw new Error(`the list barely scrolled (${scrolled}px)`)
  const topAfter = await page.locator('.topbar').boundingBox()
  if (topBefore.y !== topAfter.y) throw new Error(`header moved ${topBefore.y} -> ${topAfter.y}`)
})

await step('the menu button reveals the drawer, off-screen until opened', async () => {
  const closed = await page.locator('.sidebar').boundingBox()
  if (closed.x > -100) throw new Error(`the drawer is not tucked off-screen (x=${closed.x})`)
  await page.locator('.nav-menu-btn').click()
  await page.waitForTimeout(360)
  const open = await page.locator('.sidebar').boundingBox()
  if (Math.abs(open.x) > 2) throw new Error(`the open drawer is not flush to the left (x=${open.x})`)
})

await step('the drawer carries every section', async () => {
  const sidebar = page.locator('.sidebar')
  for (const label of ['Budget', 'Auto-Budget', 'Reports', 'All Accounts', 'Scheduled', 'Payees', 'Settings']) {
    if (!(await sidebar.getByRole('link', { name: new RegExp(label) }).count()))
      throw new Error(`drawer missing ${label}`)
  }
  if (!(await sidebar.getByRole('button', { name: 'Add Transaction' }).isVisible()))
    throw new Error('drawer missing Add Transaction')
})

await step('a drawer link navigates and closes the drawer', async () => {
  await page.locator('.sidebar').getByRole('link', { name: /Reports/ }).first().click()
  await page.waitForTimeout(600)
  if ((await page.locator('.topbar h1').innerText()) !== 'Reports')
    throw new Error('did not navigate to Reports')
  const navOpen = await page.evaluate(() => document.querySelector('.app').classList.contains('nav-open'))
  if (navOpen) throw new Error('the drawer stayed open after navigating')
})

await step('the scrim closes the drawer', async () => {
  await page.locator('.nav-menu-btn').click()
  await page.waitForTimeout(320)
  if (!(await page.locator('.nav-scrim').isVisible())) throw new Error('scrim did not appear')
  await page.locator('.nav-scrim').click({ position: { x: 340, y: 300 } })
  await page.waitForTimeout(320)
  const navOpen = await page.evaluate(() => document.querySelector('.app').classList.contains('nav-open'))
  if (navOpen) throw new Error('tapping the scrim did not close the drawer')
})

await step('a swipe from the left edge opens the drawer', async () => {
  // Synthesize a left-edge drag: touchstart at the edge, moving right past the
  // commit threshold.
  await page.evaluate(() => {
    const fire = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y })
      document.dispatchEvent(
        new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [t],
          changedTouches: [t],
          bubbles: true,
          cancelable: true,
        }),
      )
    }
    fire('touchstart', 6, 420)
    fire('touchmove', 45, 422)
    fire('touchmove', 100, 424)
    fire('touchend', 100, 424)
  })
  await page.waitForTimeout(360)
  const navOpen = await page.evaluate(() => document.querySelector('.app').classList.contains('nav-open'))
  if (!navOpen) throw new Error('the edge swipe did not open the drawer')
  await page.locator('.nav-scrim').click({ position: { x: 340, y: 300 } })
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
