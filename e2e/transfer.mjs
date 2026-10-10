/**
 * Moving a budget from one device to another: set up on a laptop, bring it
 * over to a brand-new phone from the welcome screen — by sync file and by
 * backup — without the phone's own starter categories doubling up.
 *
 *   npm run build && npm run preview   # in one shell
 *   npm run test:e2e                   # in another
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, step, finish, createAccount, dismissInstallGuide, gotoSection } from './harness.mjs'

const dir = mkdtempSync(join(tmpdir(), 'enab-transfer-'))
const laptop = await launch()
let syncPath = ''
let backupPath = ''

await step('laptop: set up a budget', async () => {
  await dismissInstallGuide(laptop.page)
  await createAccount(laptop.page, { name: 'Joint Checking', balance: '3150' })
})

await step('laptop: export a sync file and a backup', async () => {
  await gotoSection(laptop.page, 'Settings')
  await laptop.page.getByPlaceholder('Shared secret').fill('correct horse')
  await laptop.page.waitForTimeout(300)

  const [sync] = await Promise.all([
    laptop.page.waitForEvent('download'),
    laptop.page.getByRole('button', { name: 'Export', exact: true }).click(),
  ])
  syncPath = join(dir, sync.suggestedFilename())
  await sync.saveAs(syncPath)

  const [backup] = await Promise.all([
    laptop.page.waitForEvent('download'),
    laptop.page.getByRole('button', { name: /Download/ }).first().click(),
  ])
  backupPath = join(dir, backup.suggestedFilename())
  await backup.saveAs(backupPath)
  if (!syncPath.endsWith('.enab') || !backupPath.endsWith('.json')) throw new Error(`${syncPath} / ${backupPath}`)
})
await laptop.browser.close()

/** A fresh phone, standing on the welcome screen. */
async function freshPhone() {
  const phone = await launch({ device: 'iPhone 13' })
  await dismissInstallGuide(phone.page)
  return phone
}

async function expectBudgetArrived(page) {
  // Accounts and transactions arrive as separate live queries, so give the
  // second one a moment rather than reading the very first frame.
  let rta = ''
  for (let i = 0; i < 40 && !rta.includes('3,150'); i++) {
    await page.waitForTimeout(150)
    rta = await page.locator('.rta-amount').innerText().catch(() => '')
  }
  if (!rta.includes('3,150')) throw new Error(`Ready to Assign shows ${rta || 'nothing'}`)
  // The phone seeded its own starter categories; they must not double up.
  const rent = await page.locator('.cat-row', { hasText: 'Rent/Mortgage' }).count()
  if (rent !== 1) throw new Error(`Rent/Mortgage appears ${rent} times`)
}

const phone = await freshPhone()

await step('phone: the welcome screen offers the menu and a way to bring a budget over', async () => {
  if (!(await phone.page.locator('.nav-menu-btn').isVisible())) throw new Error('no menu button on the welcome screen')
  await phone.page.getByRole('button', { name: /already use ENAB on another device/ }).waitFor()
})

await step('phone: a wrong passphrase says so plainly', async () => {
  await phone.page.locator('.onboarding input[type=file]').setInputFiles(syncPath)
  await phone.page.getByLabel('Sync passphrase').fill('wrong horse')
  await phone.page.getByRole('button', { name: 'Bring it over' }).click()
  await phone.page.getByText(/passphrase doesn't open this file/).waitFor({ timeout: 8000 })
})

await step('phone: the right passphrase brings the budget over', async () => {
  await phone.page.getByLabel('Sync passphrase').fill('correct horse')
  await phone.page.getByRole('button', { name: 'Bring it over' }).click()
  await expectBudgetArrived(phone.page)
})

await step('phone: the passphrase is remembered for syncing back', async () => {
  await gotoSection(phone.page, 'Settings')
  const saved = await phone.page.getByPlaceholder('Shared secret').inputValue()
  if (saved !== 'correct horse') throw new Error('passphrase was not saved')
})
await phone.browser.close()

const phone2 = await freshPhone()
await step('another phone: a plain backup file works from the same button', async () => {
  await phone2.page.locator('.onboarding input[type=file]').setInputFiles(backupPath)
  await expectBudgetArrived(phone2.page)
})
await phone2.browser.close()

finish([...laptop.errors, ...phone.errors, ...phone2.errors])
