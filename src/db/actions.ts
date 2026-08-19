import { db } from './db'
import { CREDIT_GROUP_ID, INFLOW_CATEGORY_ID, buildSeed, defaultSettings } from './seed'
import { uid } from '../lib/id'
import { monthOf, today } from '../lib/dates'
import { nextOccurrence } from '../budget/recurrence'
import type {
  Account,
  AccountClass,
  AccountType,
  Category,
  Cents,
  ClearedStatus,
  FlagColor,
  Frequency,
  Goal,
  Id,
  ISODate,
  MonthKey,
  ScheduledTransaction,
  Settings,
  SubTransaction,
  Transaction,
} from '../types'

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

export function accountClassFor(type: AccountType): AccountClass {
  switch (type) {
    case 'checking':
    case 'savings':
    case 'cash':
      return 'budget'
    case 'creditCard':
    case 'lineOfCredit':
      return 'credit'
    default:
      return 'tracking'
  }
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  creditCard: 'Credit Card',
  lineOfCredit: 'Line of Credit',
  mortgage: 'Mortgage',
  autoLoan: 'Auto Loan',
  studentLoan: 'Student Loan',
  personalLoan: 'Personal Loan',
  medicalDebt: 'Medical Debt',
  otherDebt: 'Other Debt',
  investment: 'Investment',
  asset: 'Asset (e.g. house)',
  otherLiability: 'Other Liability',
}

/** Seed the database on first run. Safe to call on every app start. */
export async function ensureInitialized(): Promise<Settings> {
  const existing = await db.settings.get('settings')
  if (existing) return existing

  const settings = defaultSettings()
  const { groups, categories } = buildSeed()
  await db.transaction('rw', db.settings, db.categoryGroups, db.categories, async () => {
    await db.settings.put(settings)
    await db.categoryGroups.bulkPut(groups)
    await db.categories.bulkPut(categories)
  })
  return settings
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = (await db.settings.get('settings')) ?? defaultSettings()
  await db.settings.put({ ...current, ...patch, id: 'settings' })
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export interface NewAccountInput {
  name: string
  type: AccountType
  /** Signed: debt accounts take a negative balance. */
  startingBalance: Cents
  date?: ISODate
  note?: string
}

export async function createAccount(input: NewAccountInput): Promise<Id> {
  const cls = accountClassFor(input.type)
  const id = uid('acct')
  const date = input.date ?? today()
  const maxSort = (await db.accounts.orderBy('sortOrder').last())?.sortOrder ?? -1

  const account: Account = {
    id,
    name: input.name.trim() || 'New Account',
    type: input.type,
    class: cls,
    onBudget: cls !== 'tracking',
    closed: false,
    note: input.note ?? '',
    sortOrder: maxSort + 1,
    createdAt: new Date().toISOString(),
    deleted: false,
  }

  await db.transaction('rw', db.accounts, db.categories, db.transactions, db.payees, async () => {
    if (cls === 'credit') {
      // Every credit account gets its own payment category, so the money to
      // pay the bill is budgeted rather than hoped for.
      const paymentCategory: Category = {
        id: uid('cat'),
        groupId: CREDIT_GROUP_ID,
        name: account.name,
        sortOrder: maxSort + 1,
        hidden: false,
        note: '',
        linkedAccountId: id,
        deleted: false,
      }
      await db.categories.put(paymentCategory)
      account.paymentCategoryId = paymentCategory.id
    }
    await db.accounts.put(account)

    if (input.startingBalance !== 0) {
      const payeeId = await findOrCreatePayeeId('Starting Balance')
      await db.transactions.put({
        id: uid('txn'),
        accountId: id,
        date,
        month: monthOf(date),
        amount: input.startingBalance,
        payeeId,
        // A positive opening balance on a budget account is money you already
        // have, so it becomes Ready to Assign. Debt is just debt.
        categoryId: account.onBudget && input.startingBalance > 0 ? INFLOW_CATEGORY_ID : null,
        memo: '',
        cleared: 'reconciled',
        approved: true,
        flag: null,
        isStartingBalance: true,
        createdAt: new Date().toISOString(),
        deleted: false,
      })
    }
  })

  return id
}

export async function updateAccount(id: Id, patch: Partial<Account>): Promise<void> {
  const account = await db.accounts.get(id)
  if (!account) return
  await db.accounts.update(id, patch)
  // Keep the payment category's name in step with the card it pays.
  if (patch.name && account.paymentCategoryId) {
    await db.categories.update(account.paymentCategoryId, { name: patch.name })
  }
}

export async function setAccountClosed(id: Id, closed: boolean): Promise<void> {
  await db.accounts.update(id, { closed })
}

export async function deleteAccount(id: Id): Promise<void> {
  await db.transaction('rw', db.accounts, db.categories, db.transactions, db.scheduled, async () => {
    const account = await db.accounts.get(id)
    if (!account) return
    await db.accounts.update(id, { deleted: true, closed: true })
    if (account.paymentCategoryId) {
      await db.categories.update(account.paymentCategoryId, { deleted: true })
    }
    const txns = await db.transactions.where('accountId').equals(id).toArray()
    for (const t of txns) {
      await db.transactions.update(t.id, { deleted: true })
      // Take the far side of any transfer with it, or the register on the
      // other account is left pointing at an account that no longer exists.
      if (t.transferTransactionId) {
        await db.transactions.update(t.transferTransactionId, { deleted: true })
      }
    }
    const scheduled = await db.scheduled.where('accountId').equals(id).toArray()
    for (const s of scheduled) await db.scheduled.update(s.id, { deleted: true })
  })
}

export async function reorderAccounts(orderedIds: Id[]): Promise<void> {
  await db.transaction('rw', db.accounts, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.accounts.update(orderedIds[i], { sortOrder: i })
    }
  })
}

/* ------------------------------------------------------------------ */
/* Category groups and categories                                      */
/* ------------------------------------------------------------------ */

export async function createCategoryGroup(name: string): Promise<Id> {
  const id = uid('grp')
  const maxSort = (await db.categoryGroups.orderBy('sortOrder').last())?.sortOrder ?? -1
  await db.categoryGroups.put({
    id,
    name: name.trim() || 'New Group',
    sortOrder: maxSort + 1,
    hidden: false,
    collapsed: false,
    deleted: false,
  })
  return id
}

export async function updateCategoryGroup(id: Id, patch: Partial<{ name: string; collapsed: boolean; hidden: boolean }>) {
  await db.categoryGroups.update(id, patch)
}

/** Soft-delete a group, moving or hiding the categories inside it. */
export async function deleteCategoryGroup(id: Id, moveToGroupId?: Id): Promise<void> {
  await db.transaction('rw', db.categoryGroups, db.categories, async () => {
    const cats = await db.categories.where('groupId').equals(id).toArray()
    for (const c of cats) {
      if (moveToGroupId) await db.categories.update(c.id, { groupId: moveToGroupId })
      else await db.categories.update(c.id, { hidden: true })
    }
    await db.categoryGroups.update(id, { deleted: true })
  })
}

export async function createCategory(groupId: Id, name: string): Promise<Id> {
  const id = uid('cat')
  const siblings = await db.categories.where('groupId').equals(groupId).toArray()
  const maxSort = siblings.reduce((m, c) => Math.max(m, c.sortOrder), -1)
  await db.categories.put({
    id,
    groupId,
    name: name.trim() || 'New Category',
    sortOrder: maxSort + 1,
    hidden: false,
    note: '',
    deleted: false,
  })
  return id
}

export async function updateCategory(id: Id, patch: Partial<Category>): Promise<void> {
  await db.categories.update(id, patch)
}

export async function setCategoryGoal(id: Id, goal: Goal | undefined): Promise<void> {
  // Dexie stores `undefined` as a present-but-empty key, so delete explicitly.
  if (goal) await db.categories.update(id, { goal })
  else await db.categories.update(id, { goal: undefined })
}

/**
 * Delete a category. Any transactions still pointing at it are moved to
 * `reassignToId` so history never silently loses its categorisation.
 */
export async function deleteCategory(id: Id, reassignToId: Id | null = null): Promise<void> {
  await db.transaction('rw', db.categories, db.transactions, db.budgetEntries, async () => {
    const affected = await db.transactions.where('categoryId').equals(id).toArray()
    for (const t of affected) {
      await db.transactions.update(t.id, { categoryId: reassignToId })
    }
    // Splits hide their categories one level down.
    const all = await db.transactions.toArray()
    for (const t of all) {
      if (!t.subtransactions?.some((s) => s.categoryId === id)) continue
      await db.transactions.update(t.id, {
        subtransactions: t.subtransactions.map((s) =>
          s.categoryId === id ? { ...s, categoryId: reassignToId } : s,
        ),
      })
    }
    await db.budgetEntries.where('categoryId').equals(id).delete()
    await db.categories.update(id, { deleted: true })
  })
}

export async function reorderCategories(groupId: Id, orderedIds: Id[]): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.categories.update(orderedIds[i], { groupId, sortOrder: i })
    }
  })
}

export async function reorderCategoryGroups(orderedIds: Id[]): Promise<void> {
  await db.transaction('rw', db.categoryGroups, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.categoryGroups.update(orderedIds[i], { sortOrder: i })
    }
  })
}

/* ------------------------------------------------------------------ */
/* Budget entries                                                      */
/* ------------------------------------------------------------------ */

export const entryId = (month: MonthKey, categoryId: Id) => `${month}:${categoryId}`

export async function setAssigned(month: MonthKey, categoryId: Id, assigned: Cents): Promise<void> {
  const id = entryId(month, categoryId)
  if (assigned === 0) await db.budgetEntries.delete(id)
  else await db.budgetEntries.put({ id, month, categoryId, assigned })
}

export async function adjustAssigned(month: MonthKey, categoryId: Id, delta: Cents): Promise<void> {
  const current = (await db.budgetEntries.get(entryId(month, categoryId)))?.assigned ?? 0
  await setAssigned(month, categoryId, current + delta)
}

/** Assign several categories at once (used by the quick-budget actions). */
export async function setAssignedBulk(
  month: MonthKey,
  updates: { categoryId: Id; assigned: Cents }[],
): Promise<void> {
  await db.transaction('rw', db.budgetEntries, async () => {
    for (const u of updates) await setAssigned(month, u.categoryId, u.assigned)
  })
}

/**
 * Move money between envelopes. `null` means Ready to Assign, which has no
 * entry of its own — taking money from it simply means assigning less
 * elsewhere, so only the far side changes.
 */
export async function moveMoney(
  month: MonthKey,
  fromCategoryId: Id | null,
  toCategoryId: Id | null,
  amount: Cents,
): Promise<void> {
  if (amount <= 0 || fromCategoryId === toCategoryId) return
  await db.transaction('rw', db.budgetEntries, async () => {
    if (fromCategoryId) await adjustAssigned(month, fromCategoryId, -amount)
    if (toCategoryId) await adjustAssigned(month, toCategoryId, amount)
  })
}

export async function setMonthNote(month: MonthKey, note: string): Promise<void> {
  if (note.trim()) await db.monthNotes.put({ month, note })
  else await db.monthNotes.delete(month)
}

/* ------------------------------------------------------------------ */
/* Payees                                                              */
/* ------------------------------------------------------------------ */

export async function findOrCreatePayeeId(name: string): Promise<Id | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const existing = await db.payees.where('name').equalsIgnoreCase(trimmed).first()
  if (existing && !existing.deleted) return existing.id
  const id = uid('payee')
  await db.payees.put({ id, name: trimmed, deleted: false })
  return id
}

/** The payee that represents "the other side is my own account". */
async function transferPayeeId(accountId: Id): Promise<Id> {
  const existing = await db.payees.where('transferAccountId').equals(accountId).first()
  if (existing && !existing.deleted) return existing.id
  const account = await db.accounts.get(accountId)
  const id = uid('payee')
  await db.payees.put({
    id,
    name: `Transfer : ${account?.name ?? 'Account'}`,
    transferAccountId: accountId,
    deleted: false,
  })
  return id
}

export async function renamePayee(id: Id, name: string): Promise<void> {
  await db.payees.update(id, { name: name.trim() })
}

export async function deletePayee(id: Id): Promise<void> {
  await db.transaction('rw', db.payees, db.transactions, async () => {
    const affected = await db.transactions.where('payeeId').equals(id).toArray()
    for (const t of affected) await db.transactions.update(t.id, { payeeId: null })
    await db.payees.update(id, { deleted: true })
  })
}

/** Fold `sourceIds` into `targetId`, repointing every transaction. */
export async function mergePayees(sourceIds: Id[], targetId: Id): Promise<void> {
  await db.transaction('rw', db.payees, db.transactions, async () => {
    for (const sourceId of sourceIds) {
      if (sourceId === targetId) continue
      const affected = await db.transactions.where('payeeId').equals(sourceId).toArray()
      for (const t of affected) await db.transactions.update(t.id, { payeeId: targetId })
      await db.payees.update(sourceId, { deleted: true })
    }
  })
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export interface TransactionInput {
  accountId: Id
  date: ISODate
  amount: Cents
  payeeId?: Id | null
  payeeName?: string
  categoryId?: Id | null
  memo?: string
  cleared?: ClearedStatus
  approved?: boolean
  flag?: FlagColor
  /** Set to make this a transfer to another account. */
  transferAccountId?: Id | null
  subtransactions?: Omit<SubTransaction, 'id'>[]
  scheduledId?: Id
}

/**
 * Create a transaction, handling the three shapes the register can produce:
 * a plain one, a split, and a transfer (which is really two linked rows).
 */
export async function createTransaction(input: TransactionInput): Promise<Id> {
  const now = new Date().toISOString()
  const id = uid('txn')
  const month = monthOf(input.date)

  return db.transaction('rw', db.transactions, db.payees, db.accounts, db.categories, async () => {
    let payeeId = input.payeeId ?? null
    if (!payeeId && input.payeeName) payeeId = await findOrCreatePayeeId(input.payeeName)

    const subtransactions = input.subtransactions?.map((s) => ({ ...s, id: uid('sub') }))

    const base: Transaction = {
      id,
      accountId: input.accountId,
      date: input.date,
      month,
      amount: input.amount,
      payeeId,
      categoryId: subtransactions?.length ? null : (input.categoryId ?? null),
      memo: input.memo ?? '',
      cleared: input.cleared ?? 'uncleared',
      approved: input.approved ?? true,
      flag: input.flag ?? null,
      subtransactions,
      scheduledId: input.scheduledId,
      createdAt: now,
      deleted: false,
    }

    if (input.transferAccountId) {
      const [from, to] = await Promise.all([
        db.accounts.get(input.accountId),
        db.accounts.get(input.transferAccountId),
      ])
      const siblingId = uid('txn')
      base.transferAccountId = input.transferAccountId
      base.transferTransactionId = siblingId
      base.payeeId = await transferPayeeId(input.transferAccountId)

      // A transfer between two on-budget accounts is not spending, so neither
      // leg carries a category. When one side is off budget the on-budget leg
      // keeps its category, because that money really is entering or leaving
      // the budget.
      const bothOnBudget = !!from?.onBudget && !!to?.onBudget
      if (bothOnBudget) base.categoryId = null

      const sibling: Transaction = {
        ...base,
        id: siblingId,
        accountId: input.transferAccountId,
        amount: -input.amount,
        categoryId: null,
        subtransactions: undefined,
        transferAccountId: input.accountId,
        transferTransactionId: id,
        payeeId: await transferPayeeId(input.accountId),
        cleared: 'uncleared',
      }
      await db.transactions.bulkPut([base, sibling])
    } else {
      await db.transactions.put(base)
    }

    // Remember what this payee is usually for, so next time it fills itself in.
    if (payeeId && base.categoryId && !input.transferAccountId) {
      await db.payees.update(payeeId, { lastCategoryId: base.categoryId })
    }
    return id
  })
}

export async function updateTransaction(id: Id, patch: Partial<TransactionInput> & { subtransactions?: SubTransaction[] }): Promise<void> {
  await db.transaction('rw', db.transactions, db.payees, db.accounts, async () => {
    const existing = await db.transactions.get(id)
    if (!existing) return

    let payeeId = patch.payeeId !== undefined ? patch.payeeId : existing.payeeId
    if (patch.payeeName !== undefined && !patch.payeeId) {
      payeeId = await findOrCreatePayeeId(patch.payeeName)
    }

    const next: Transaction = {
      ...existing,
      ...('date' in patch && patch.date ? { date: patch.date, month: monthOf(patch.date) } : {}),
      ...('amount' in patch && patch.amount !== undefined ? { amount: patch.amount } : {}),
      ...('memo' in patch ? { memo: patch.memo ?? '' } : {}),
      ...('cleared' in patch && patch.cleared ? { cleared: patch.cleared } : {}),
      ...('approved' in patch && patch.approved !== undefined ? { approved: patch.approved } : {}),
      ...('flag' in patch ? { flag: patch.flag ?? null } : {}),
      ...('categoryId' in patch ? { categoryId: patch.categoryId ?? null } : {}),
      ...('subtransactions' in patch
        ? {
            subtransactions: patch.subtransactions?.length
              ? (patch.subtransactions as SubTransaction[]).map((s) => ({ ...s, id: s.id || uid('sub') }))
              : undefined,
          }
        : {}),
      payeeId,
    }
    if (next.subtransactions?.length) next.categoryId = null

    await db.transactions.put(next)

    // Keep the far side of a transfer in step: date and amount mirror, and
    // the memo is shared, but each side keeps its own cleared status.
    if (next.transferTransactionId) {
      const sibling = await db.transactions.get(next.transferTransactionId)
      if (sibling) {
        await db.transactions.put({
          ...sibling,
          date: next.date,
          month: next.month,
          amount: -next.amount,
          memo: next.memo,
          flag: next.flag,
        })
      }
    }

    if (payeeId && next.categoryId && !next.transferAccountId) {
      await db.payees.update(payeeId, { lastCategoryId: next.categoryId })
    }
  })
}

export async function deleteTransaction(id: Id): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    const t = await db.transactions.get(id)
    if (!t) return
    await db.transactions.update(id, { deleted: true })
    if (t.transferTransactionId) {
      await db.transactions.update(t.transferTransactionId, { deleted: true })
    }
  })
}

export async function deleteTransactions(ids: Id[]): Promise<void> {
  for (const id of ids) await deleteTransaction(id)
}

export async function setClearedStatus(ids: Id[], cleared: ClearedStatus): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) await db.transactions.update(id, { cleared })
  })
}

export async function setApproved(ids: Id[], approved: boolean): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) await db.transactions.update(id, { approved })
  })
}

export async function setFlag(ids: Id[], flag: FlagColor): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) await db.transactions.update(id, { flag })
  })
}

export async function categorizeTransactions(ids: Id[], categoryId: Id | null): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id)
      // Splits already carry categories on their legs; don't stomp them.
      if (!t || t.transferTransactionId || t.subtransactions?.length) continue
      await db.transactions.update(id, { categoryId })
    }
  })
}

export async function moveTransactionsToAccount(ids: Id[], accountId: Id): Promise<void> {
  await db.transaction('rw', db.transactions, async () => {
    for (const id of ids) {
      const t = await db.transactions.get(id)
      if (!t || t.transferTransactionId) continue
      await db.transactions.update(id, { accountId })
    }
  })
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

export interface ReconcileResult {
  adjustment: Cents
  reconciledCount: number
}

/**
 * Reconcile an account against the balance the bank actually shows.
 *
 * Anything already cleared becomes locked-in reconciled history; any gap
 * between that and the real balance becomes a single visible adjustment
 * transaction rather than a silent edit.
 */
export async function reconcileAccount(
  accountId: Id,
  actualClearedBalance: Cents,
  date: ISODate = today(),
): Promise<ReconcileResult> {
  return db.transaction('rw', db.transactions, db.accounts, db.payees, async () => {
    const account = await db.accounts.get(accountId)
    const txns = (await db.transactions.where('accountId').equals(accountId).toArray()).filter(
      (t) => !t.deleted,
    )
    const clearedBalance = txns
      .filter((t) => t.cleared !== 'uncleared')
      .reduce((sum, t) => sum + t.amount, 0)

    const adjustment = actualClearedBalance - clearedBalance
    if (adjustment !== 0) {
      const payeeId = await findOrCreatePayeeId('Reconciliation Balance Adjustment')
      await db.transactions.put({
        id: uid('txn'),
        accountId,
        date,
        month: monthOf(date),
        amount: adjustment,
        payeeId,
        categoryId: account?.onBudget ? INFLOW_CATEGORY_ID : null,
        memo: 'Entered automatically by ENAB',
        cleared: 'reconciled',
        approved: true,
        flag: null,
        createdAt: new Date().toISOString(),
        deleted: false,
      })
    }

    const toLock = txns.filter((t) => t.cleared === 'cleared')
    for (const t of toLock) await db.transactions.update(t.id, { cleared: 'reconciled' })
    await db.accounts.update(accountId, { lastReconciledAt: new Date().toISOString() })

    return { adjustment, reconciledCount: toLock.length + (adjustment !== 0 ? 1 : 0) }
  })
}

/* ------------------------------------------------------------------ */
/* Scheduled transactions                                              */
/* ------------------------------------------------------------------ */

export async function createScheduled(
  input: Omit<ScheduledTransaction, 'id' | 'deleted'>,
): Promise<Id> {
  const id = uid('sched')
  await db.scheduled.put({ ...input, id, deleted: false })
  return id
}

/**
 * Turn a transaction that was just entered into a repeating schedule.
 *
 * Reading the saved row back — rather than re-deriving from form state — keeps
 * the schedule byte-for-byte consistent with what was actually recorded,
 * payee included. `nextDate` skips to the *following* occurrence, because the
 * first one has already been entered; leaving it on the same date would make
 * the next auto-enter pass duplicate it.
 */
export async function scheduleFromTransaction(
  transactionId: Id,
  frequency: Frequency,
  opts: { autoEnter?: boolean } = {},
): Promise<Id | null> {
  if (frequency === 'once') return null
  const t = await db.transactions.get(transactionId)
  if (!t) return null

  return createScheduled({
    accountId: t.accountId,
    nextDate: nextOccurrence(t.date, frequency) ?? t.date,
    frequency,
    amount: t.amount,
    payeeId: t.payeeId,
    categoryId: t.categoryId,
    memo: t.memo,
    flag: t.flag,
    transferAccountId: t.transferAccountId ?? null,
    subtransactions: t.subtransactions,
    autoEnter: opts.autoEnter ?? true,
    paused: false,
  })
}

export async function updateScheduled(id: Id, patch: Partial<ScheduledTransaction>): Promise<void> {
  await db.scheduled.update(id, patch)
}

export async function deleteScheduled(id: Id): Promise<void> {
  await db.scheduled.update(id, { deleted: true })
}

/** Turn one occurrence into a real transaction and advance the schedule. */
export async function enterScheduled(id: Id, date?: ISODate): Promise<Id | null> {
  const s = await db.scheduled.get(id)
  if (!s || s.deleted) return null
  const when = date ?? s.nextDate

  const txnId = await createTransaction({
    accountId: s.accountId,
    date: when,
    amount: s.amount,
    payeeId: s.payeeId,
    categoryId: s.categoryId,
    memo: s.memo,
    flag: s.flag,
    cleared: 'uncleared',
    transferAccountId: s.transferAccountId ?? null,
    subtransactions: s.subtransactions?.map(({ id: _drop, ...rest }) => rest),
    scheduledId: s.id,
  })

  await advanceSchedule(s)
  return txnId
}

/** Move a schedule past its next date without creating anything. */
export async function skipScheduled(id: Id): Promise<void> {
  const s = await db.scheduled.get(id)
  if (!s || s.deleted) return
  await advanceSchedule(s)
}

async function advanceSchedule(s: ScheduledTransaction): Promise<void> {
  const next = nextOccurrence(s.nextDate, s.frequency)
  if (next) await db.scheduled.update(s.id, { nextDate: next })
  else await db.scheduled.update(s.id, { deleted: true })
}

/**
 * Enter every due occurrence of every auto-enter schedule. Called once on
 * app start; catches up correctly after the app has been closed for weeks.
 */
export async function runAutoEnter(asOf: ISODate = today()): Promise<number> {
  const schedules = (await db.scheduled.toArray()).filter(
    (s) => !s.deleted && !s.paused && s.autoEnter,
  )
  let entered = 0
  for (const s of schedules) {
    let current = await db.scheduled.get(s.id)
    let guard = 0
    while (current && !current.deleted && current.nextDate <= asOf && guard++ < 500) {
      await enterScheduled(current.id, current.nextDate)
      entered++
      current = await db.scheduled.get(s.id)
    }
  }
  return entered
}
