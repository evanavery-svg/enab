import { describe, expect, it } from 'vitest'
import { computeBudget } from '../../budget/engine'
import { account, category, entry, txn } from '../../budget/__tests__/helpers'
import { buildCheckIn, dayLabel } from '../today'
import type { Payee, ScheduledTransaction, Subscription } from '../../types'

const TODAY = '2026-10-14' // a Wednesday

function setup() {
  const checking = account('Checking')
  const inflow = category('Inflow', { isInflow: true })
  const groceries = category('Groceries')
  const dining = category('Dining out')
  const phone = category('Phone', { goal: { type: 'need', amount: 8_000, cadence: 'monthly', startMonth: '2026-01' } })
  const subsCat = category('Subscriptions', { goal: { type: 'need', amount: 0, cadence: 'monthly', startMonth: '2026-01', bills: [], source: 'subscriptions' } })
  const payees: Payee[] = [{ id: 'p-electric', name: 'City Electric', deleted: false }]
  const transactions = [
    txn(checking.id, '2026-10-01', 300_000, { categoryId: inflow.id }),
    txn(checking.id, '2026-10-05', -12_000, { categoryId: dining.id }), // overspends dining by 20
    txn(checking.id, '2026-10-12', -4_000, { categoryId: groceries.id }), // Monday: this week
    txn(checking.id, '2026-10-13', -2_500, { approved: false }), // uncategorized + unapproved
    txn(checking.id, '2026-10-11', -9_900, { categoryId: groceries.id }), // last week
  ]
  const entries = [entry('2026-10', groceries.id, 50_000), entry('2026-10', dining.id, 10_000), entry('2026-10', subsCat.id, 1_000)]
  const categories = [inflow, groceries, dining, phone, subsCat]
  const budget = computeBudget({ accounts: [checking], categories, transactions, entries, throughMonth: '2026-11' })
  const scheduled: ScheduledTransaction[] = [
    { id: 'sch1', accountId: checking.id, nextDate: '2026-10-16', frequency: 'monthly', amount: -12_000, payeeId: 'p-electric', categoryId: groceries.id, memo: '', flag: null, autoEnter: false, paused: false, deleted: false },
    { id: 'sch2', accountId: checking.id, nextDate: '2026-11-30', frequency: 'monthly', amount: -5_000, payeeId: null, categoryId: null, memo: 'far off', flag: null, autoEnter: false, paused: false, deleted: false },
  ]
  const sub = (name: string, amount: number, billingDay: number): Subscription => ({
    id: name, name, amount, amountIsEstimate: false, cadence: 'monthly', billingDay, billingMonth: null, billedThrough: '',
    status: 'active', createdAt: '2026-01-01T00:00:00Z', deleted: false,
  })
  const subscriptions = [sub('Claude', 2_299, 15), sub('Netflix', 1_599, 30), sub('City Electric', 12_000, 16)]
  return buildCheckIn({ today: TODAY, budget, accounts: [checking], categories, payees, transactions, scheduled, subscriptions })
}

describe('buildCheckIn', () => {
  const c = setup()

  it('reports money waiting for a job', () => {
    expect(c.readyToAssign).toBe(300_000 - 61_000)
  })

  it('lists overspent categories', () => {
    expect(c.overspent.map((o) => [o.name, o.amount])).toEqual([['Dining out', 2_000]])
  })

  it('finds transactions to approve and to categorize', () => {
    expect(c.unapproved).toHaveLength(1)
    expect(c.uncategorized).toHaveLength(1)
  })

  it('collects the next week of bills, without listing a subscription twice', () => {
    expect(c.upcoming.map((b) => [b.name, b.date])).toEqual([
      ['Claude', '2026-10-15'],
      ['City Electric', '2026-10-16'],
    ])
  })

  it('flags a bill its category cannot cover', () => {
    // Groceries holds 500 - 40 - 99 = 361; the 120 electric bill fits.
    expect(c.upcoming.find((b) => b.name === 'City Electric')?.short).toBe(0)
    // Subscriptions holds 10; Claude is 22.99.
    expect(c.upcoming.find((b) => b.name === 'Claude')?.short).toBe(1_299)
  })

  it('totals underfunded targets and this week’s spending', () => {
    expect(c.underfunded).toEqual({ count: 1, amount: 8_000 })
    expect(c.spentThisWeek).toBe(4_000 + 2_500)
  })

  it('counts what needs attention', () => {
    // ready to assign, one overspent, to approve, to categorize, one short bill
    expect(c.attention).toBe(5)
  })
})

describe('dayLabel', () => {
  it('reads like people talk', () => {
    expect(dayLabel('2026-10-14', TODAY)).toBe('today')
    expect(dayLabel('2026-10-15', TODAY)).toBe('tomorrow')
    expect(dayLabel('2026-10-17', TODAY)).toBe('Sat')
    expect(dayLabel('2026-10-24', TODAY)).toBe('in 10 days')
  })
})
