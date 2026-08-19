import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, clearAllTables } from '../db'
import {
  createAccount,
  createTransaction,
  ensureInitialized,
  reconcileAccount,
  runAutoEnter,
  scheduleFromTransaction,
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
