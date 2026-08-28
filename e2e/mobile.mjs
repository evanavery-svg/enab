/**
 * Phone behaviour: the page scrolls natively (no clipped, exact-100dvh shell —
 * see the comment on `html` in base.css for why), the header stays sticky at
 * the true top edge, the Ready to Assign bar sticks to the true bottom edge on
 * Budget, and form fields never dip under the 16px that makes iOS Safari zoom
 * the page.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { launch, step, finish, addTransaction, gotoSection } from './harness.mjs'

const { browser, context, page, errors } = await launch({ device: 'iPhone 13' })

/**
 * A real, browser-trusted touch drag via CDP — touchstart, several
 * touchmoves, touchend. This is what actually exercises native scrolling.
 * `page.evaluate(() => window.scrollTo(...))` and a synthetic
 * `document.dispatchEvent(new TouchEvent(...))` both bypass it entirely (the
 * former just sets scroll position directly with no gesture involved at all;
 * the latter dispatches an event my own JS listeners can react to, but
 * untrusted synthetic events never trigger the browser's built-in scroll
 * behaviour) — so a test built on either can pass while a real finger swipe
 * does nothing, which is exactly the gap that let a broken CSS cascade slip
 * through undetected once already.
 */
async function touchScroll(fromY, toY, x = 195) {
  const cdp = await context.newCDPSession(page)
  const steps = 5
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] })
  for (let i = 1; i <= steps; i++) {
    const y = fromY + ((toY - fromY) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] })
    await page.waitForTimeout(25)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(400)
}

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

await step('the Ready to Assign bar sits flush on the true bottom edge', async () => {
  // The bar is `position: sticky; bottom: 0` in a page that scrolls natively
  // (see .rta-wrap's mobile override in pages.css) — not sized to fit a
  // precise container height — so it should land exactly on the viewport's
  // bottom edge regardless of how tall the page turns out to be.
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('.rta-wrap')
    const r = bar.getBoundingClientRect()
    return Math.round(window.innerHeight - r.bottom)
  })
  if (Math.abs(gap) > 2) throw new Error(`the RTA bar is ${gap}px off the bottom edge`)
})

await step('a screen without a bottom bar has none, and still fills the screen', async () => {
  await gotoSection(page, 'Accounts')
  const shell = await page.evaluate(() => {
    const app = document.querySelector('.app')
    return {
      hasRtaBar: !!document.querySelector('.rta-wrap'),
      // A short page (few accounts) still visually fills the screen via
      // `.app`'s min-height: 100dvh, rather than leaving a gap of a
      // different colour below whatever content there is.
      appHeight: Math.round(app.getBoundingClientRect().height),
    }
  })
  if (shell.hasRtaBar) throw new Error('the RTA bar leaked onto a screen that should not have it')
  const viewport = await page.evaluate(() => window.innerHeight)
  if (shell.appHeight + 2 < viewport)
    throw new Error(`the app is only ${shell.appHeight}px tall against a ${viewport}px viewport`)
  await gotoSection(page, 'Budget')
})

await step('expanding the Ready to Assign detail keeps the bar on the bottom edge', async () => {
  await page.locator('.rta').click()
  await page.waitForTimeout(300)
  if (!(await page.locator('.rta-detail').isVisible())) throw new Error('the detail panel did not open')
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('.rta-wrap')
    return Math.round(window.innerHeight - bar.getBoundingClientRect().bottom)
  })
  if (Math.abs(gap) > 2) throw new Error(`the bar drifted ${gap}px off the bottom edge while expanded`)
  await page.locator('.rta').click()
  await page.waitForTimeout(300)
})

await step('the header sits on the true top edge', async () => {
  const top = await page.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().top))
  if (top !== 0) throw new Error(`the header starts at ${top}px, not the top edge`)
})

await step('a real finger swipe scrolls the page', async () => {
  const before = await page.evaluate(() => window.scrollY)
  await touchScroll(650, 200)
  const after = await page.evaluate(() => window.scrollY)
  if (after <= before) throw new Error(`a real touch drag did not scroll the page (scrollY stayed at ${after})`)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
})

await step('the page itself scrolls, the ordinary webpage way', async () => {
  // The deliberate model on a phone: no clipped 100dvh shell, just a normal
  // document that scrolls when its content is taller than the viewport.
  const before = await page.evaluate(() => window.scrollY)
  await page.evaluate(() => window.scrollTo(0, 1400))
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => window.scrollY)
  if (after <= before) throw new Error(`the page did not scroll (scrollY stayed at ${after})`)
})

await step('the sticky header holds still while the page scrolls under it', async () => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(200)
  const topBefore = await page.locator('.topbar').boundingBox()
  await page.evaluate(() => window.scrollTo(0, 1400))
  await page.waitForTimeout(400)
  const topAfter = await page.locator('.topbar').boundingBox()
  if (topBefore.y !== topAfter.y) throw new Error(`header moved ${topBefore.y} -> ${topAfter.y}`)
  const scrollY = await page.evaluate(() => window.scrollY)
  if (scrollY < 100) throw new Error(`the page barely scrolled (${scrollY}px)`)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
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
