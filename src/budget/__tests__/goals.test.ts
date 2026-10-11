import { describe, expect, it } from 'vitest'
import { evaluateGoal } from '../goals'
import type { Goal } from '../../types'

const ctx = (over: Partial<Parameters<typeof evaluateGoal>[1]> = {}) => ({
  month: '2025-03',
  carriedOver: 0,
  assigned: 0,
  activity: 0,
  ...over,
})

describe('monthly need targets', () => {
  const goal: Goal = { type: 'need', amount: 50_000, cadence: 'monthly', fundingStyle: 'refill', startMonth: '2025-01' }

  it('asks for the full amount in an empty category', () => {
    expect(evaluateGoal(goal, ctx()).underfunded).toBe(50_000)
  })

  it('counts money already carried over when refilling', () => {
    const r = evaluateGoal(goal, ctx({ carriedOver: 20_000 }))
    expect(r.target).toBe(30_000)
    expect(r.underfunded).toBe(30_000)
  })

  it('is satisfied once assigned', () => {
    expect(evaluateGoal(goal, ctx({ assigned: 50_000 })).underfunded).toBe(0)
  })

  it('ignores carried-over money in set-aside mode', () => {
    const setAside: Goal = { ...goal, fundingStyle: 'setAside' }
    expect(evaluateGoal(setAside, ctx({ carriedOver: 20_000 })).underfunded).toBe(50_000)
  })

  it('does not apply before its start month', () => {
    expect(evaluateGoal({ ...goal, startMonth: '2025-06' }, ctx()).underfunded).toBe(0)
  })
})

describe('weekly need targets', () => {
  it('scales by how many times the weekday falls in the month', () => {
    // August 2025 has five Fridays.
    const goal: Goal = { type: 'need', amount: 10_000, cadence: 'weekly', dayOfWeek: 5, fundingStyle: 'setAside', startMonth: '2025-01' }
    expect(evaluateGoal(goal, ctx({ month: '2025-08' })).target).toBe(50_000)
    // September 2025 has four.
    expect(evaluateGoal(goal, ctx({ month: '2025-09' })).target).toBe(40_000)
  })
})

describe('multi-month need targets', () => {
  it('spreads the amount over the months until it is due', () => {
    const goal: Goal = {
      type: 'need',
      amount: 60_000,
      cadence: 'custom',
      every: 6,
      cadenceUnit: 'month',
      fundingStyle: 'refill',
      startMonth: '2025-01',
      targetMonth: '2025-06',
    }
    // January: six months to go, so a sixth each month.
    expect(evaluateGoal(goal, ctx({ month: '2025-01' })).target).toBe(10_000)
    // April with 30,000 saved: 30,000 left over three months.
    expect(evaluateGoal(goal, ctx({ month: '2025-04', carriedOver: 30_000 })).target).toBe(10_000)
  })

  it('rolls to the next occurrence after the due month passes', () => {
    const goal: Goal = {
      type: 'need',
      amount: 60_000,
      cadence: 'yearly',
      fundingStyle: 'refill',
      startMonth: '2025-01',
      targetMonth: '2025-06',
    }
    const r = evaluateGoal(goal, ctx({ month: '2025-07' }))
    expect(r.dueMonth).toBe('2026-06')
    expect(r.target).toBe(5_000)
  })
})

describe('balance targets', () => {
  it('asks for whatever is left with no deadline', () => {
    const goal: Goal = { type: 'balance', amount: 100_000, startMonth: '2025-01' }
    const r = evaluateGoal(goal, ctx({ carriedOver: 40_000 }))
    expect(r.target).toBe(60_000)
    expect(r.percent).toBeCloseTo(0.4)
  })

  it('spreads a dated balance target evenly', () => {
    const goal: Goal = { type: 'balanceByDate', amount: 120_000, startMonth: '2025-01', targetMonth: '2025-06' }
    // March through June inclusive is four months.
    expect(evaluateGoal(goal, ctx({ month: '2025-03' })).target).toBe(30_000)
  })

  it('flags a dated target that was never met', () => {
    const goal: Goal = { type: 'balanceByDate', amount: 120_000, startMonth: '2025-01', targetMonth: '2025-02' }
    expect(evaluateGoal(goal, ctx({ month: '2025-03', carriedOver: 50_000 })).missed).toBe(true)
  })
})

describe('bill bundles (funding subscriptions)', () => {
  const goal: Goal = {
    type: 'need',
    amount: 2966,
    cadence: 'monthly',
    startMonth: '2026-01',
    bills: [
      { name: 'Claude', amount: 2299, everyMonths: 1 },
      { name: 'PlayStation Plus', amount: 7999, everyMonths: 12, dueMonth: '2026-10' },
    ],
  }
  const at = (month: string, carriedOver = 0, assigned = 0) => evaluateGoal(goal, { month, carriedOver, assigned, activity: 0 })

  it('saves a yearly bill a twelfth at a time after it renews', () => {
    expect(at('2026-11').target).toBe(2299 + 667)
    expect(at('2027-04', 3335).target).toBe(2299 + 4000 - 3335)
  })

  it('asks for the whole renewal in its month when nothing was put by', () => {
    expect(at('2026-10').target).toBe(2299 + 7999)
  })

  it('asks for only the monthly bills once the yearly share is already there', () => {
    // September of a fully funded year: 11/12 of the renewal already sits in the category.
    const r = at('2026-09', Math.ceil((7999 * 11) / 12), 2299)
    expect(r.target).toBe(2299)
    expect(r.underfunded).toBe(0)
  })

  it('treats any year of the due month as the renewal month', () => {
    expect(at('2030-10').target).toBe(2299 + 7999)
  })
})
