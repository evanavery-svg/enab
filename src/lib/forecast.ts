import { occurrencesBetween, nextOccurrence } from '../budget/recurrence'
import { addDays, compareIso, daysBetween } from './dates'
import { nextCharge } from './subscriptions'
import type { Account, Cents, Frequency, Id, ISODate, Payee, ScheduledTransaction, Subscription, Transaction } from '../types'

export interface DayEvent {
  key: string
  name: string
  /** Signed effect on the chosen accounts. */
  amount: Cents
  kind: 'actual' | 'scheduled' | 'subscription'
  /** Subscriptions are usually charged to a card or PayPal, so they're shown but not counted. */
  counted: boolean
}

export interface ForecastDay {
  date: ISODate
  /** End-of-day balance: real for past days, projected from today on. */
  balance: Cents
  projected: boolean
  events: DayEvent[]
}

export interface Forecast {
  days: ForecastDay[]
  /** The lowest projected end-of-day balance from today to the end. */
  low: { date: ISODate; balance: Cents }
  /** The next projected money in, if any. */
  nextIncome: { date: ISODate; amount: Cents } | null
}

export interface ForecastInput {
  today: ISODate
  /** First and last day to return. */
  from: ISODate
  to: ISODate
  accountIds: Id[]
  accounts: Account[]
  transactions: Transaction[]
  scheduled: ScheduledTransaction[]
  subscriptions: Subscription[]
  payees: Payee[]
}

/**
 * Day-by-day balance for a set of accounts: what really happened up to today,
 * then today's balance carried forward through everything scheduled. A
 * scheduled transfer between two of the chosen accounts cancels out; one in
 * from another account counts as money arriving.
 */
export function buildForecast(input: ForecastInput): Forecast {
  const chosen = new Set(input.accountIds)
  const payeeName = new Map(input.payees.map((p) => [p.id, p.name]))
  const accountName = new Map(input.accounts.map((a) => [a.id, a.name]))
  const events = new Map<ISODate, DayEvent[]>()
  const push = (date: ISODate, e: DayEvent) => {
    const list = events.get(date)
    if (list) list.push(e)
    else events.set(date, [e])
  }

  // Real transactions: everything up to `from` folds into an opening balance.
  let opening = 0
  for (const t of input.transactions) {
    if (t.deleted || !chosen.has(t.accountId)) continue
    if (t.date < input.from) {
      opening += t.amount
      continue
    }
    if (t.date > input.to) continue
    push(t.date, {
      key: t.id,
      name: (t.payeeId && payeeName.get(t.payeeId)) || (t.transferAccountId ? `Transfer · ${accountName.get(t.transferAccountId) ?? ''}` : t.memo || 'Transaction'),
      amount: t.amount,
      kind: 'actual',
      // A move between two chosen accounts nets out, but each side still shows.
      counted: true,
    })
  }

  // Scheduled: from today on. Anything overdue (not yet entered) lands today.
  for (const s of input.scheduled) {
    if (s.deleted || s.paused) continue
    const own = chosen.has(s.accountId)
    const other = s.transferAccountId ? chosen.has(s.transferAccountId) : false
    if (own && other) continue
    if (!own && !other) continue
    const amount = own ? s.amount : -s.amount
    const name = (s.payeeId && payeeName.get(s.payeeId)) || (s.transferAccountId ? `Transfer · ${accountName.get(own ? s.transferAccountId : s.accountId) ?? ''}` : s.memo || 'Scheduled')
    let start = s.nextDate
    while (start < input.today) {
      push(input.today, { key: `${s.id}@${start}`, name: `${name} (due)`, amount, kind: 'scheduled', counted: true })
      const n = nextOccurrence(start, s.frequency as Frequency)
      if (!n) {
        start = ''
        break
      }
      start = n
    }
    if (!start) continue
    for (const date of occurrencesBetween(start, s.frequency as Frequency, input.today < input.from ? input.from : input.today, input.to)) {
      if (date < input.today) continue
      push(date, { key: `${s.id}@${date}`, name, amount, kind: 'scheduled', counted: true })
    }
  }

  // Subscriptions: markers only, unless a scheduled transaction already covers them.
  const scheduledNames = [...events.values()].flat().filter((e) => e.kind === 'scheduled').map((e) => e.name.toLowerCase())
  for (const sub of input.subscriptions) {
    if (sub.deleted || sub.status !== 'active' || !sub.amount) continue
    let date = nextCharge(sub, input.today)
    const covered = scheduledNames.some((n) => n.includes(sub.name.toLowerCase()))
    while (date && date <= input.to && !covered) {
      if (date >= input.from) push(date, { key: `sub:${sub.id}@${date}`, name: sub.name, amount: -sub.amount, kind: 'subscription', counted: false })
      const next: ISODate | null = nextCharge(sub, addDays(date, 1))
      date = next && next > date ? next : null
    }
  }

  const days: ForecastDay[] = []
  let balance = opening
  let low: Forecast['low'] | null = null
  let nextIncome: Forecast['nextIncome'] = null
  for (let date = input.from, guard = 0; date <= input.to && guard < 800; date = addDays(date, 1), guard++) {
    const list = (events.get(date) ?? []).sort((a, b) => Number(b.counted) - Number(a.counted) || a.amount - b.amount)
    const projected = date > input.today
    for (const e of list) {
      if (!e.counted) continue
      balance += e.amount
      if (date >= input.today && e.kind === 'scheduled' && e.amount > 0 && !nextIncome) nextIncome = { date, amount: e.amount }
    }
    days.push({ date, balance, projected, events: list })
    if (date >= input.today && (!low || balance < low.balance)) low = { date, balance }
  }
  return { days, low: low ?? { date: input.today, balance }, nextIncome }
}

export interface IncomeGuess {
  payeeId: Id
  name: string
  amount: Cents
  accountId: Id
  categoryId: Id | null
  frequency: Frequency
  nextDate: ISODate
}

/**
 * A paycheck that isn't scheduled yet: the same payee paying into one of the
 * chosen accounts at a steady weekly, fortnightly, twice-monthly or monthly
 * rhythm, at least three times.
 */
export function guessIncome(input: Pick<ForecastInput, 'today' | 'accountIds' | 'transactions' | 'scheduled' | 'payees'>): IncomeGuess | null {
  const chosen = new Set(input.accountIds)
  const scheduledPayees = new Set(input.scheduled.filter((s) => !s.deleted && s.amount > 0).map((s) => s.payeeId))
  const byPayee = new Map<Id, Transaction[]>()
  const since = addDays(input.today, -120)
  for (const t of input.transactions) {
    if (t.deleted || t.amount <= 0 || !t.payeeId || t.transferAccountId || !chosen.has(t.accountId) || t.date < since) continue
    if (scheduledPayees.has(t.payeeId)) continue
    const list = byPayee.get(t.payeeId)
    if (list) list.push(t)
    else byPayee.set(t.payeeId, [t])
  }
  let best: IncomeGuess | null = null
  let bestMonthly = 0
  for (const [payeeId, list] of byPayee) {
    if (list.length < 3) continue
    list.sort((a, b) => compareIso(a.date, b.date))
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date)).sort((a, b) => a - b)
    const gap = gaps[Math.floor(gaps.length / 2)]
    const frequency: Frequency | null =
      gap >= 6 && gap <= 8
        ? 'weekly'
        : gap >= 13 && gap <= 17 && sameDaysOfMonth(list)
          ? 'twiceAMonth'
          : gap >= 13 && gap <= 15
            ? 'everyOtherWeek'
            : gap >= 27 && gap <= 33
              ? 'monthly'
              : null
    if (!frequency) continue
    const amounts = list.map((t) => t.amount).sort((a, b) => a - b)
    const amount = amounts[Math.floor(amounts.length / 2)]
    let next = list[list.length - 1].date
    if (frequency === 'twiceAMonth') {
      // Land on the days it actually arrives (the 1st and 15th), not 15 days on.
      const paydays = new Set(list.map((t) => Number(t.date.slice(8, 10))))
      next = addDays(input.today, 1)
      for (let i = 0; i < 40 && !paydays.has(Number(next.slice(8, 10))); i++) next = addDays(next, 1)
    } else {
      for (let i = 0; i < 60 && next <= input.today; i++) next = nextOccurrence(next, frequency) ?? addDays(next, 30)
    }
    const perMonth = amount * (frequency === 'weekly' ? 4.33 : frequency === 'monthly' ? 1 : 2)
    if (perMonth > bestMonthly) {
      bestMonthly = perMonth
      const last = list[list.length - 1]
      best = { payeeId, name: input.payees.find((p) => p.id === payeeId)?.name ?? 'Paycheck', amount, accountId: last.accountId, categoryId: last.categoryId, frequency, nextDate: next }
    }
  }
  return best
}

/** Paid on the same two days each month (1st & 15th), rather than every 14 days. */
function sameDaysOfMonth(list: Transaction[]): boolean {
  const days = new Set(list.map((t) => Number(t.date.slice(8, 10))))
  return days.size <= 2
}
