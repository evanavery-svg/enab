import { describe, expect, it } from 'vitest'
import { account, txn } from '../../budget/__tests__/helpers'
import { buildForecast, guessIncome } from '../forecast'
import type { Payee, ScheduledTransaction, Subscription } from '../../types'

const checking = account('Checking')
const savings = account('Savings', 'savings')
const card = account('Visa', 'creditCard')
const payees: Payee[] = [
  { id: 'job', name: 'Acme Payroll', deleted: false },
  { id: 'rent', name: 'Landlord', deleted: false },
]
const sched = (over: Partial<ScheduledTransaction>): ScheduledTransaction => ({
  id: over.id ?? 's', accountId: checking.id, nextDate: '2026-10-15', frequency: 'monthly', amount: -100, payeeId: null,
  categoryId: null, memo: '', flag: null, autoEnter: false, paused: false, deleted: false, ...over,
})
const transactions = [
  txn(checking.id, '2026-09-01', 200_000, { isStartingBalance: true }),
  txn(checking.id, '2026-10-02', -50_000, { payeeId: 'rent' }),
  txn(checking.id, '2026-10-05', -2_000),
  txn(savings.id, '2026-10-05', 999_999),
]
const base = {
  today: '2026-10-10',
  from: '2026-10-01',
  to: '2026-11-30',
  accountIds: [checking.id],
  accounts: [checking, savings, card],
  transactions,
  payees,
  subscriptions: [] as Subscription[],
}
const day = (f: ReturnType<typeof buildForecast>, d: string) => f.days.find((x) => x.date === d)!

describe('buildForecast', () => {
  it('shows real balances up to today, then projects scheduled money', () => {
    const f = buildForecast({
      ...base,
      scheduled: [
        sched({ id: 'pay', amount: 300_000, frequency: 'everyOtherWeek', nextDate: '2026-10-16', payeeId: 'job' }),
        sched({ id: 'rentS', amount: -50_000, nextDate: '2026-11-02', payeeId: 'rent' }),
      ],
    })
    expect(day(f, '2026-10-01').balance).toBe(200_000)
    expect(day(f, '2026-10-05').balance).toBe(148_000)
    expect(day(f, '2026-10-10').projected).toBe(false)
    expect(day(f, '2026-10-16').balance).toBe(448_000)
    expect(day(f, '2026-11-02').balance).toBe(698_000)
    expect(f.nextIncome).toEqual({ date: '2026-10-16', amount: 300_000 })
    expect(f.low).toEqual({ date: '2026-10-10', balance: 148_000 })
  })

  it('finds the low point before payday', () => {
    const f = buildForecast({
      ...base,
      scheduled: [sched({ id: 'big', amount: -140_000, nextDate: '2026-10-20' }), sched({ id: 'pay', amount: 300_000, nextDate: '2026-10-30' })],
    })
    expect(f.low).toEqual({ date: '2026-10-20', balance: 8_000 })
  })

  it('counts an overdue bill today, and transfers by direction', () => {
    const f = buildForecast({
      ...base,
      scheduled: [
        sched({ id: 'late', amount: -1_000, nextDate: '2026-10-08', frequency: 'once' }),
        sched({ id: 'in', accountId: savings.id, transferAccountId: checking.id, amount: -20_000, nextDate: '2026-10-12', frequency: 'once' }),
        sched({ id: 'pay-card', accountId: checking.id, transferAccountId: card.id, amount: -30_000, nextDate: '2026-10-14', frequency: 'once' }),
      ],
    })
    expect(day(f, '2026-10-10').balance).toBe(147_000)
    expect(day(f, '2026-10-12').balance).toBe(167_000)
    expect(day(f, '2026-10-14').balance).toBe(137_000)
  })

  it('shows subscriptions without counting them', () => {
    const sub: Subscription = {
      id: 'claude', name: 'Claude', amount: 2_299, amountIsEstimate: false, cadence: 'monthly', billingDay: 30, billingMonth: null,
      billedThrough: 'Apple', status: 'active', createdAt: '2026-01-01T00:00:00Z', deleted: false,
    }
    const f = buildForecast({ ...base, scheduled: [], subscriptions: [sub] })
    const e = day(f, '2026-10-30').events
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ name: 'Claude', counted: false })
    expect(day(f, '2026-11-30').events[0]?.name).toBe('Claude')
    expect(day(f, '2026-10-30').balance).toBe(148_000)
  })
})

describe('guessIncome', () => {
  it('spots a fortnightly paycheck that is not scheduled', () => {
    const pay = ['2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02'].map((d) => txn(checking.id, d, 300_000, { payeeId: 'job' }))
    const g = guessIncome({ today: '2026-10-10', accountIds: [checking.id], transactions: pay, scheduled: [], payees })
    expect(g).toMatchObject({ name: 'Acme Payroll', amount: 300_000, frequency: 'everyOtherWeek', nextDate: '2026-10-16' })
  })

  it('recognises the 1st-and-15th pattern', () => {
    const pay = ['2026-08-15', '2026-09-01', '2026-09-15', '2026-10-01'].map((d) => txn(checking.id, d, 150_000, { payeeId: 'job' }))
    const g = guessIncome({ today: '2026-10-10', accountIds: [checking.id], transactions: pay, scheduled: [], payees })
    expect(g).toMatchObject({ frequency: 'twiceAMonth', nextDate: '2026-10-15' })
  })

  it('stays quiet once the paycheck is scheduled', () => {
    const pay = ['2026-08-21', '2026-09-04', '2026-09-18', '2026-10-02'].map((d) => txn(checking.id, d, 300_000, { payeeId: 'job' }))
    const g = guessIncome({ today: '2026-10-10', accountIds: [checking.id], transactions: pay, scheduled: [sched({ amount: 300_000, payeeId: 'job' })], payees })
    expect(g).toBeNull()
  })
})
