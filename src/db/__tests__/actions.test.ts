import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { liveQuery } from 'dexie'
import { db, clearAllTables } from '../db'
import {
  createAccount,
  addAttachment,
  createTransaction,
  deleteTransaction,
  deleteTransactions,
  setClearedStatus,
  enterScheduled,
  getAttachments,
  importTransactions,
  ensureInitialized,
  reconcileAccount,
  runAutoEnter,
  scheduleFromTransaction,
  updateTransaction,
} from '../actions'
import { INFLOW_CATEGORY_ID } from '../seed'
import { addMonthsToDate, today } from '../../lib/dates'

beforeEach(async () => {
  await clearAllTables()
  await ensureInitialized()
})

describe('scheduleFromTransaction', () => {
  it('copies the saved transaction, payee included', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const txnId = await createTransaction({
      accountId,
      date: '2026-03-10',
      amount: -6_999,
      payeeName: 'Fibernet',
      memo: 'broadband',
    })

    const scheduledId = await scheduleFromTransaction(txnId, 'monthly')
    const scheduled = await db.scheduled.get(scheduledId!)
    const txn = await db.transactions.get(txnId)

    expect(scheduled).toBeTruthy()
    expect(scheduled!.payeeId).toBe(txn!.payeeId)
    expect(scheduled!.payeeId).not.toBeNull()
    expect(scheduled!.amount).toBe(-6_999)
    expect(scheduled!.memo).toBe('broadband')
  })

  it('starts at the next occurrence, not the one already entered', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const txnId = await createTransaction({ accountId, date: '2026-03-10', amount: -1_000, payeeName: 'Gym' })

    const scheduledId = await scheduleFromTransaction(txnId, 'monthly')
    expect((await db.scheduled.get(scheduledId!))!.nextDate).toBe('2026-04-10')
  })

  it('does not immediately re-enter the transaction it came from', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const date = today()
    const txnId = await createTransaction({ accountId, date, amount: -1_000, payeeName: 'Gym' })
    await scheduleFromTransaction(txnId, 'monthly')

    const before = await db.transactions.count()
    await runAutoEnter(date)
    expect(await db.transactions.count()).toBe(before)

    // It does fire once the next date arrives.
    await runAutoEnter(addMonthsToDate(date, 1))
    expect(await db.transactions.count()).toBe(before + 1)
  })

  it('is a no-op for one-off transactions', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const txnId = await createTransaction({ accountId, date: '2026-03-10', amount: -1_000 })
    expect(await scheduleFromTransaction(txnId, 'once')).toBeNull()
    expect(await db.scheduled.count()).toBe(0)
  })
})

describe('createAccount', () => {
  it('gives a credit card its own payment category', async () => {
    const accountId = await createAccount({ name: 'Visa', type: 'creditCard', startingBalance: -50_000 })
    const account = await db.accounts.get(accountId)
    expect(account!.class).toBe('credit')
    expect(account!.onBudget).toBe(true)

    const category = await db.categories.get(account!.paymentCategoryId!)
    expect(category!.name).toBe('Visa')
    expect(category!.linkedAccountId).toBe(accountId)
  })

  it('sends a positive opening balance to Ready to Assign but leaves debt uncategorised', async () => {
    const checking = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 25_000 })
    const card = await createAccount({ name: 'Visa', type: 'creditCard', startingBalance: -50_000 })

    const opening = async (id: string) =>
      (await db.transactions.where('accountId').equals(id).toArray()).find((t) => t.isStartingBalance)

    expect((await opening(checking))!.categoryId).toBe(INFLOW_CATEGORY_ID)
    expect((await opening(card))!.categoryId).toBeNull()
  })
})

describe('transfers', () => {
  it('creates both legs and keeps them linked', async () => {
    const from = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const to = await createAccount({ name: 'Savings', type: 'savings', startingBalance: 0 })

    const id = await createTransaction({ accountId: from, date: '2026-03-01', amount: -20_000, transferAccountId: to })
    const out = await db.transactions.get(id)
    const back = await db.transactions.get(out!.transferTransactionId!)

    expect(out!.amount).toBe(-20_000)
    expect(back!.amount).toBe(20_000)
    expect(back!.accountId).toBe(to)
    expect(back!.transferTransactionId).toBe(id)
    // Neither side is spending, so neither carries a category.
    expect(out!.categoryId).toBeNull()
    expect(back!.categoryId).toBeNull()
  })
})

describe('reconcileAccount', () => {
  it('records the difference as a visible adjustment and locks what was cleared', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    await createTransaction({ accountId, date: '2026-03-02', amount: -2_500, cleared: 'cleared' })

    const result = await reconcileAccount(accountId, 95_000, '2026-03-03')
    expect(result.adjustment).toBe(-2_500)

    const rows = await db.transactions.where('accountId').equals(accountId).toArray()
    expect(rows.every((t) => t.cleared === 'reconciled')).toBe(true)
    expect(rows.some((t) => t.amount === -2_500 && t.memo.includes('automatically'))).toBe(true)
  })

  it('locks everything cleared when the balance already matches', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    await createTransaction({ accountId, date: '2026-03-02', amount: -2_500, cleared: 'cleared' })

    const result = await reconcileAccount(accountId, 97_500, '2026-03-03')
    expect(result.adjustment).toBe(0)
    expect(await db.transactions.count()).toBe(2)
  })
})

describe('updateTransaction', () => {
  it('moves a transaction to a different account', async () => {
    const checking = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const savings = await createAccount({ name: 'Savings', type: 'savings', startingBalance: 0 })
    const id = await createTransaction({ accountId: checking, date: today(), amount: -2_500, memo: 'coffee' })

    await updateTransaction(id, { accountId: savings })

    expect((await db.transactions.get(id))?.accountId).toBe(savings)
  })

  it('repoints the far side when a transfer changes account', async () => {
    const checking = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const savings = await createAccount({ name: 'Savings', type: 'savings', startingBalance: 0 })
    const other = await createAccount({ name: 'Other', type: 'checking', startingBalance: 0 })
    const id = await createTransaction({
      accountId: checking,
      date: today(),
      amount: -5_000,
      transferAccountId: savings,
    })

    await updateTransaction(id, { accountId: other })

    const moved = (await db.transactions.get(id))!
    const sibling = (await db.transactions.get(moved.transferTransactionId!))!
    expect(moved.accountId).toBe(other)
    // The far side still lives in Savings, but must now point back at Other.
    expect(sibling.accountId).toBe(savings)
    expect(sibling.transferAccountId).toBe(other)
  })
})

describe('auto-entered occurrences', () => {
  it('gives the same occurrence the same id on every device', async () => {
    // Two devices catching up offline must not each invent an id, or the next
    // sync leaves the budget paying the same bill twice.
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const txnId = await createTransaction({ accountId, date: today(), amount: -1_500, memo: 'rent' })
    const schedId = await scheduleFromTransaction(txnId, 'monthly', { autoEnter: true })
    const sched = (await db.scheduled.get(schedId!))!

    const first = await enterScheduled(sched.id, '2026-05-02')
    await db.scheduled.update(sched.id, { nextDate: '2026-05-02' })
    const again = await enterScheduled(sched.id, '2026-05-02')

    expect(first).toBe(again)
    const rows = (await db.transactions.toArray()).filter((t) => t.scheduledId === sched.id && !t.deleted)
    expect(rows).toHaveLength(1)
  })
})

describe('deleteTransaction', () => {
  it('releases the attachment bytes and hides the receipts', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 100_000 })
    const id = await createTransaction({ accountId, date: today(), amount: -2_500, memo: 'coffee' })
    await addAttachment(id, new File(['receipt'], 'receipt.txt', { type: 'text/plain' }))

    await deleteTransaction(id)

    // A tombstone stays so the deletion can sync, but it carries no bytes.
    expect(await getAttachments(id)).toHaveLength(0)
    const row = (await db.attachments.toArray())[0]
    expect(row.deleted).toBe(true)
    expect(row.size).toBe(0)
    expect(row.data.size).toBe(0)
  })
})

describe('bulk register actions', () => {
  it('stamps updatedAt so bulk edits still sync', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const a = await createTransaction({ accountId, date: today(), amount: -100 })
    const b = await createTransaction({ accountId, date: today(), amount: -200 })
    const before = (await db.transactions.get(a))!.updatedAt!

    await new Promise((r) => setTimeout(r, 2))
    await setClearedStatus([a, b], 'cleared')

    for (const id of [a, b]) {
      const t = (await db.transactions.get(id))!
      expect(t.cleared).toBe('cleared')
      expect(t.updatedAt! > before).toBe(true)
    }
  })

  it('deletes a selection, transfer far sides included, in one commit', async () => {
    const checking = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const savings = await createAccount({ name: 'Savings', type: 'savings', startingBalance: 0 })
    const plain = await createTransaction({ accountId: checking, date: today(), amount: -100 })
    const transfer = await createTransaction({ accountId: checking, date: today(), amount: -500, transferAccountId: savings })
    const far = (await db.transactions.get(transfer))!.transferTransactionId!

    const seen: number[] = []
    const sub = liveQuery(() => db.transactions.count()).subscribe((n) => seen.push(n))
    await new Promise((r) => setTimeout(r, 20))
    const emissionsBefore = seen.length

    await deleteTransactions([plain, transfer])
    await new Promise((r) => setTimeout(r, 20))
    sub.unsubscribe()

    for (const id of [plain, transfer, far]) expect((await db.transactions.get(id))!.deleted).toBe(true)
    // One commit means the UI recomputes once, not once per row.
    expect(seen.length - emissionsBefore).toBe(1)
  })
})

describe('importTransactions', () => {
  const row = (date: string, amount: number, payee: string, categoryId: string | null = null) => ({
    date, amount, payee, memo: '', categoryId,
  })

  it("keeps today's balance when the history predates the opening balance", async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 240_000, date: '2026-10-10' })
    await importTransactions(
      accountId,
      [row('2026-09-01', 300_000, 'Acme Payroll'), row('2026-09-15', -60_000, 'Landlord'), row('2026-10-12', -1_000, 'Cafe')],
      { keepBalance: true },
    )
    const live = (await db.transactions.where('accountId').equals(accountId).toArray()).filter((t) => !t.deleted)
    const balance = live.reduce((s, t) => s + t.amount, 0)
    // The two September rows were already inside the $2,400 typed in on Oct 10;
    // only the Oct 12 coffee is new money movement.
    expect(balance).toBe(240_000 - 1_000)
    const opening = live.find((t) => t.isStartingBalance)!
    expect(opening.date).toBe('2026-08-31')
    expect(opening.amount).toBe(240_000 - (300_000 - 60_000))
  })

  it('adds history on top when asked not to keep the balance', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 240_000, date: '2026-10-10' })
    await importTransactions(accountId, [row('2026-09-15', -60_000, 'Landlord')], { keepBalance: false })
    const live = (await db.transactions.where('accountId').equals(accountId).toArray()).filter((t) => !t.deleted)
    expect(live.reduce((s, t) => s + t.amount, 0)).toBe(180_000)
  })

  it('gives a known payee the category it had last time, including earlier rows in the same file', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const groceries = (await db.categories.toArray()).find((c) => c.name === 'Groceries')!
    const result = await importTransactions(accountId, [
      row('2026-09-01', -4_000, 'Green Grocer', groceries.id),
      row('2026-09-08', -3_500, 'Green Grocer'),
      row('2026-09-09', -900, 'Somewhere New'),
    ])
    const txns = await db.transactions.where('accountId').equals(accountId).toArray()
    expect(txns.find((t) => t.date === '2026-09-08')!.categoryId).toBe(groceries.id)
    expect(txns.find((t) => t.date === '2026-09-09')!.categoryId).toBeNull()
    expect(result.categorized).toBe(2)
    // One payee per name, not one per row.
    expect((await db.payees.toArray()).filter((p) => p.name === 'Green Grocer')).toHaveLength(1)
  })

  it('commits once, so the budget recomputes once for the whole file', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const seen: number[] = []
    const sub = liveQuery(() => db.transactions.count()).subscribe((n) => seen.push(n))
    await new Promise((r) => setTimeout(r, 20))
    const before = seen.length

    await importTransactions(accountId, Array.from({ length: 50 }, (_, i) => row('2026-09-01', -100 - i, `Shop ${i}`)))
    await new Promise((r) => setTimeout(r, 20))
    sub.unsubscribe()

    expect(seen.length - before).toBe(1)
    expect(seen.at(-1)).toBe(50)
  })

  it('writes nothing at all if any row fails', async () => {
    const accountId = await createAccount({ name: 'Checking', type: 'checking', startingBalance: 0 })
    const bad = { ...row('2026-09-02', -200, 'Shop'), date: undefined as unknown as string }
    await expect(importTransactions(accountId, [row('2026-09-01', -100, 'Shop'), bad])).rejects.toThrow()
    expect(await db.transactions.where('accountId').equals(accountId).count()).toBe(0)
  })
})
