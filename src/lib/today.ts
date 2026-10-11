import { addDays, compareIso, daysBetween, fromISODate, monthOf } from './dates'
import { nextCharge } from './subscriptions'
import type { BudgetResult } from '../budget/engine'
import type { Account, Category, Cents, Id, Payee, ScheduledTransaction, Subscription, Transaction } from '../types'

/** How far ahead "coming up" looks. */
export const UPCOMING_DAYS = 7

export interface UpcomingBill {
  key: string
  kind: 'scheduled' | 'subscription'
  /** Scheduled transaction or subscription id. */
  id: Id
  name: string
  date: string
  /** Positive amount going out. */
  amount: Cents
  categoryId: Id | null
  /** What the category can't cover by then, counting earlier bills from it. */
  short: Cents
}

export interface CheckIn {
  readyToAssign: Cents
  overspent: { categoryId: Id; name: string; amount: Cents }[]
  unapproved: Transaction[]
  uncategorized: Transaction[]
  upcoming: UpcomingBill[]
  underfunded: { count: number; amount: Cents }
  /** Spending since Monday, as a positive number. */
  spentThisWeek: Cents
  /** Things asking for a decision; the number on the menu. */
  attention: number
}

export interface CheckInInput {
  today: string
  budget: BudgetResult
  accounts: Account[]
  categories: Category[]
  payees: Payee[]
  transactions: Transaction[]
  scheduled: ScheduledTransaction[]
  subscriptions: Subscription[]
}

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

export function buildCheckIn(input: CheckInInput): CheckIn {
  const { today, budget } = input
  const month = monthOf(today)
  const states = budget.categoryStates.get(month)
  const accountById = new Map(input.accounts.map((a) => [a.id, a]))
  const payeeById = new Map(input.payees.map((p) => [p.id, p]))
  const live = (a?: Account) => !!a && !a.deleted && !a.closed

  const readyToAssign = budget.summaries.get(month)?.readyToAssign ?? 0

  const overspent: CheckIn['overspent'] = []
  let underCount = 0
  let underAmount = 0
  for (const c of input.categories) {
    if (c.deleted || c.hidden || c.isInflow) continue
    const s = states?.get(c.id)
    if (!s) continue
    if (s.available < 0) overspent.push({ categoryId: c.id, name: c.name, amount: -s.available })
    if (s.goalUnderfunded > 0 && !(c.goal?.snoozedThrough && c.goal.snoozedThrough >= month)) {
      underCount++
      underAmount += s.goalUnderfunded
    }
  }
  overspent.sort((a, b) => b.amount - a.amount)

  const unapproved: Transaction[] = []
  const uncategorized: Transaction[] = []
  // Monday-start week.
  const weekday = (fromISODate(today).getDay() + 6) % 7
  const weekStart = addDays(today, -weekday)
  let spentThisWeek = 0
  for (const t of input.transactions) {
    if (t.deleted) continue
    const account = accountById.get(t.accountId)
    if (!live(account)) continue
    if (!t.approved) unapproved.push(t)
    if (!account!.onBudget) continue
    const counterpart = t.transferAccountId ? accountById.get(t.transferAccountId) : undefined
    const internal = !!counterpart && counterpart.onBudget && !counterpart.deleted
    if (!t.categoryId && !t.subtransactions?.length && !internal && !t.isStartingBalance) uncategorized.push(t)
    if (!internal && t.amount < 0 && t.date >= weekStart && t.date <= today) spentThisWeek -= t.amount
  }
  const newestFirst = (a: Transaction, b: Transaction) => compareIso(b.date, a.date) || compareIso(b.createdAt, a.createdAt)
  unapproved.sort(newestFirst)
  uncategorized.sort(newestFirst)

  // Bills in the next week: scheduled outflows, then subscriptions that
  // aren't already a scheduled transaction.
  const horizon = addDays(today, UPCOMING_DAYS)
  const upcoming: UpcomingBill[] = []
  const scheduledNames = new Set<string>()
  for (const s of input.scheduled) {
    if (s.deleted || s.paused || s.amount >= 0 || s.nextDate > horizon) continue
    if (!live(accountById.get(s.accountId))) continue
    const name = (s.payeeId && payeeById.get(s.payeeId)?.name) || s.memo || 'Scheduled'
    scheduledNames.add(normal(name))
    upcoming.push({ key: `s:${s.id}`, kind: 'scheduled', id: s.id, name, date: s.nextDate < today ? today : s.nextDate, amount: -s.amount, categoryId: s.categoryId, short: 0 })
  }
  const fundingCategory = input.categories.find((c) => !c.deleted && c.goal?.source === 'subscriptions')?.id ?? null
  for (const sub of input.subscriptions) {
    if (sub.deleted || sub.status !== 'active' || !sub.amount) continue
    const next = nextCharge(sub, today)
    if (!next || next > horizon) continue
    const key = normal(sub.name)
    if ([...scheduledNames].some((n) => n.includes(key) || key.includes(n))) continue
    upcoming.push({ key: `sub:${sub.id}`, kind: 'subscription', id: sub.id, name: sub.name, date: next, amount: sub.amount, categoryId: fundingCategory, short: 0 })
  }
  upcoming.sort((a, b) => compareIso(a.date, b.date) || b.amount - a.amount)
  const left = new Map<Id, Cents>()
  for (const bill of upcoming) {
    if (!bill.categoryId) continue
    // A bill next month draws on next month's money, which isn't assigned yet.
    if (monthOf(bill.date) !== month) continue
    const have = left.get(bill.categoryId) ?? Math.max(0, states?.get(bill.categoryId)?.available ?? 0)
    bill.short = Math.max(0, bill.amount - have)
    left.set(bill.categoryId, Math.max(0, have - bill.amount))
  }

  const attention =
    (readyToAssign !== 0 ? 1 : 0) +
    overspent.length +
    (unapproved.length ? 1 : 0) +
    (uncategorized.length ? 1 : 0) +
    upcoming.filter((b) => b.short > 0).length

  return {
    readyToAssign,
    overspent,
    unapproved,
    uncategorized,
    upcoming,
    underfunded: { count: underCount, amount: underAmount },
    spentThisWeek,
    attention,
  }
}

/** "today", "tomorrow", "Wed", or "in 9 days". */
export function dayLabel(date: string, today: string): string {
  const d = daysBetween(today, date)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][fromISODate(date).getDay()]
  return `in ${d} days`
}
