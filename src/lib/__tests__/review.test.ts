import { describe, expect, it } from 'vitest'
import { computeBudget } from '../../budget/engine'
import { account, category, entry, txn } from '../../budget/__tests__/helpers'
import { buildReview, raisedGoal } from '../review'

const checking = account('Checking')
const inflow = category('Inflow', { isInflow: true })
const groceries = category('Groceries', { groupId: 'g1' })
const dining = category('Dining', { groupId: 'g1', goal: { type: 'need', amount: 10_000, cadence: 'monthly', startMonth: '2026-01' } })
const fun = category('Fun', { groupId: 'g1' })
const rent = category('Rent', { groupId: 'g1', goal: { type: 'balanceByDate', amount: 200_000, startMonth: '2026-01', targetMonth: '2026-12' } })
const categories = [inflow, groceries, dining, fun, rent]
const groups = [{ id: 'g1', name: 'Everyday', sortOrder: 0, hidden: false, collapsed: false, deleted: false }]

const spend = (d: string, cat: string, amount: number) => txn(checking.id, d, -amount, { categoryId: cat })
const transactions = [
  txn(checking.id, '2026-07-01', 1_000_000, { categoryId: inflow.id }),
  txn(checking.id, '2026-09-01', 400_000, { categoryId: inflow.id }),
  // Groceries: over plan three months running.
  spend('2026-07-10', groceries.id, 45_000), spend('2026-08-10', groceries.id, 48_000), spend('2026-09-10', groceries.id, 52_000),
  // Dining: over this month only.
  spend('2026-08-12', dining.id, 6_000), spend('2026-09-12', dining.id, 14_000),
  // Fun: under plan, money left over.
  spend('2026-09-15', fun.id, 2_000),
  // Rent: over, but its target is a savings goal.
  spend('2026-08-01', rent.id, 150_000), spend('2026-09-01', rent.id, 150_000),
]
const entries = [
  ...['2026-07', '2026-08', '2026-09'].map((m) => entry(m, groceries.id, 40_000)),
  entry('2026-08', dining.id, 10_000), entry('2026-09', dining.id, 10_000),
  entry('2026-09', fun.id, 10_000),
  entry('2026-08', rent.id, 100_000), entry('2026-09', rent.id, 100_000),
]
const budget = computeBudget({ accounts: [checking], categories, transactions, entries, throughMonth: '2026-10' })
const r = buildReview({ month: '2026-09', budget, categories, groups })

describe('buildReview', () => {
  it('sums income, spending and the plan', () => {
    expect(r.income).toBe(400_000)
    expect(r.spent).toBe(52_000 + 14_000 + 2_000 + 150_000)
    expect(r.planned).toBe(40_000 + 10_000 + 10_000 + 100_000)
  })

  it('lists what went over plan, with streaks', () => {
    expect(r.overPlan.map((c) => [c.name, c.overStreak])).toEqual([['Rent', 2], ['Groceries', 3], ['Dining', 1]])
  })

  it('suggests a target only for plain monthly categories that keep going over', () => {
    expect(r.suggestions.map((s) => [s.category.name, s.amount, s.current])).toEqual([['Groceries', 48_500, null]])
  })

  it('reports changes and what carries forward', () => {
    expect(r.changes.find((c) => c.category.name === 'Dining')?.delta).toBe(8_000)
    expect(r.carriedTop.map((c) => c.name)).toContain('Fun')
    expect(r.carried).toBeGreaterThanOrEqual(8_000)
  })
})

describe('raisedGoal', () => {
  it('keeps an existing target’s settings', () => {
    expect(raisedGoal({ type: 'need', amount: 1, cadence: 'monthly', fundingStyle: 'setAside', startMonth: '2026-01' }, 5_000, '2026-10')).toEqual({
      type: 'need', amount: 5_000, cadence: 'monthly', fundingStyle: 'setAside', startMonth: '2026-01',
    })
    expect(raisedGoal(undefined, 5_000, '2026-10')).toMatchObject({ type: 'need', amount: 5_000, startMonth: '2026-10' })
  })
})
