import type { Account, Cents, ISODate, Transaction } from '../types'
import { daysBetween } from '../lib/dates'

interface Chunk {
  date: ISODate
  amount: Cents
}

export interface AgeOfMoneyResult {
  /** Average age in days of the money spent on the last 10 expenses. */
  days: number | null
  /** `{ date, days }` for each expense that consumed income, oldest first. */
  history: { date: ISODate; days: number }[]
}

/**
 * Age of Money, the way YNAB frames it: how long the dollars you just spent
 * sat in your accounts before you spent them.
 *
 * Income is a FIFO queue of dated dollars. Every expense drains the queue from
 * the front, and the age recorded for that expense is the age of the *oldest*
 * dollar it consumed. The headline number averages the last ten of those.
 */
export function computeAgeOfMoney(
  accounts: Account[],
  transactions: Transaction[],
  sampleSize = 10,
): AgeOfMoneyResult {
  const onBudget = new Set(accounts.filter((a) => a.onBudget && !a.deleted).map((a) => a.id))
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  type Event = { date: ISODate; amount: Cents; kind: 'in' | 'out' }
  const events: Event[] = []

  for (const t of transactions) {
    if (t.deleted || !onBudget.has(t.accountId)) continue

    const legs =
      t.subtransactions && t.subtransactions.length
        ? t.subtransactions.map((s) => ({ amount: s.amount, transferAccountId: s.transferAccountId ?? null }))
        : [{ amount: t.amount, transferAccountId: t.transferAccountId ?? null }]

    for (const leg of legs) {
      const counterpart = leg.transferAccountId ? accountById.get(leg.transferAccountId) : undefined
      // Moving money between your own on-budget accounts doesn't age it.
      if (counterpart && counterpart.onBudget && !counterpart.deleted) continue
      if (leg.amount === 0) continue
      events.push({
        date: t.date,
        amount: Math.abs(leg.amount),
        kind: leg.amount > 0 ? 'in' : 'out',
      })
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'in' ? -1 : 1))

  const queue: Chunk[] = []
  let head = 0
  const history: { date: ISODate; days: number }[] = []

  for (const ev of events) {
    if (ev.kind === 'in') {
      queue.push({ date: ev.date, amount: ev.amount })
      continue
    }
    let remaining = ev.amount
    let oldest: ISODate | null = null
    while (remaining > 0 && head < queue.length) {
      const chunk = queue[head]
      if (!oldest) oldest = chunk.date
      const take = Math.min(remaining, chunk.amount)
      chunk.amount -= take
      remaining -= take
      if (chunk.amount === 0) head++
    }
    if (oldest) history.push({ date: ev.date, days: Math.max(0, daysBetween(oldest, ev.date)) })
  }

  const sample = history.slice(-sampleSize)
  const days = sample.length
    ? Math.round(sample.reduce((sum, h) => sum + h.days, 0) / sample.length)
    : null

  return { days, history }
}
