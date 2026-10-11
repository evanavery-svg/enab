import { describe, expect, it } from 'vitest'
import { billingLabel, brandOf, draftFromSeries, isTracked, monthlyCost, nextCharge, savedSoFar, totals, whenLabel, yearlyCost } from '../subscriptions'
import type { RecurringSeries } from '../../budget/analyze'
import type { Subscription } from '../../types'

let n = 0
const sub = (name: string, amount: number | null, cadence: Subscription['cadence'], extra: Partial<Subscription> = {}): Subscription => ({
  id: `s${++n}`, name, amount, amountIsEstimate: false, cadence, billingDay: null, billingMonth: null,
  billedThrough: '', status: 'active', createdAt: '', deleted: false, ...extra,
})

// The list this page was designed from.
const active = [
  sub('Claude', 2299, 'monthly', { billingDay: 30, billedThrough: 'Apple' }),
  sub('PlayStation Plus', 7999, 'yearly', { billingDay: 14, billingMonth: 10, billedThrough: 'PayPal' }),
  sub('Nintendo Switch Online', 4999, 'yearly', { billingDay: 25, billingMonth: 12, billedThrough: 'PayPal' }),
  sub('YouTube Premium', null, 'monthly'),
  sub('Google', 999, 'monthly', { billingDay: 28, billedThrough: 'PayPal' }),
  sub('Apple storage (iCloud+)', 999, 'monthly', { billingDay: 30, billedThrough: 'Apple' }),
  sub('Ring Solo Plan', 539, 'monthly', { billingDay: 24, billedThrough: 'Ring' }),
]
const cancelled = [
  sub('Google', 2179, 'monthly', { status: 'cancelled' }),
  sub('Disney+', 2159, 'monthly', { status: 'cancelled' }),
  sub('ChatGPT', 2000, 'monthly', { status: 'cancelled', amountIsEstimate: true }),
  sub('Audible', 1495, 'monthly', { status: 'cancelled' }),
  sub('Fortnite Crew', 1199, 'monthly', { status: 'cancelled' }),
  sub('Amazon Digital', 539, 'monthly', { status: 'cancelled' }),
  sub('IGN', 499, 'monthly', { status: 'cancelled' }),
]

describe('totals', () => {
  it('matches the hand-worked figures: ~$59.20/mo (~$710/yr) + YouTube Premium', () => {
    const t = totals(active)
    expect(t.yearly).toBe(71030)
    expect(t.monthly).toBe(5919) // 710.30 / 12
    expect(t.unpriced.map((s) => s.name)).toEqual(['YouTube Premium'])
    expect(t.priced).toBe(6)
    expect(t.approximate).toBe(false)
  })

  it('totals what cancelling saved: ~$100.70/mo (~$1,208/yr), marked approximate', () => {
    const t = totals(cancelled)
    expect(t.monthly).toBe(10070)
    expect(t.yearly).toBe(120840)
    expect(t.approximate).toBe(true) // ChatGPT is "~$20"
  })

  it('spreads a yearly plan over twelve months', () => {
    expect(monthlyCost(active[1])).toBe(667)
    expect(yearlyCost(active[1])).toBe(7999)
    expect(yearlyCost(sub('Weekly', 500, 'weekly'))).toBe(26000)
  })
})

describe('dates', () => {
  it('labels billing dates the way people say them', () => {
    expect(billingLabel(active[0])).toBe('~30th')
    expect(billingLabel(active[1])).toBe('Oct 14')
    expect(billingLabel(active[4])).toBe('~28th')
    expect(billingLabel(sub('x', 1, 'monthly', { billingDay: 31 }))).toBe('End of month')
    expect(billingLabel(sub('x', 1, 'monthly', { billingDay: 1 }))).toBe('~1st')
    expect(billingLabel(sub('x', 1, 'monthly', { billingDay: 22 }))).toBe('~22nd')
    expect(billingLabel(sub('x', 1, 'monthly', { billingDay: 11 }))).toBe('~11th')
    expect(billingLabel(active[3])).toBeNull()
  })

  it('finds the next charge, clamping the 30th to the end of a short month', () => {
    expect(nextCharge(active[0], '2026-10-11')).toBe('2026-10-30')
    expect(nextCharge(active[0], '2027-02-10')).toBe('2027-02-28')
    expect(nextCharge(active[6], '2026-10-25')).toBe('2026-11-24')
    expect(nextCharge(active[1], '2026-10-11')).toBe('2026-10-14')
    expect(nextCharge(active[1], '2026-10-15')).toBe('2027-10-14')
    expect(nextCharge(active[3], '2026-10-11')).toBeNull()
  })

  it('says when in words', () => {
    expect(whenLabel('2026-10-11', '2026-10-11')).toBe('today')
    expect(whenLabel('2026-10-12', '2026-10-11')).toBe('tomorrow')
    expect(whenLabel('2026-10-14', '2026-10-11')).toBe('in 3 days')
    expect(whenLabel('2026-12-25', '2026-10-11')).toBe('Dec 25')
  })

  it('counts savings in whole months since cancelling', () => {
    const disney = { ...cancelled[1], cancelledOn: '2026-04-27' }
    expect(savedSoFar(disney, '2026-10-26')).toBe(2159 * 5)
    expect(savedSoFar(disney, '2026-10-27')).toBe(2159 * 6)
    expect(savedSoFar(cancelled[1], '2026-10-27')).toBeNull() // no date, no claim
  })
})

describe('avatars', () => {
  it('knows the services from the list, and picks readable letters', () => {
    expect(brandOf('Claude').bg).toBe('#d97757')
    expect(brandOf('PlayStation Plus').bg).toBe('#0070d1')
    expect(brandOf('Amazon Digital').fg).toBe('#16161a') // dark letter on light yellow
    expect(brandOf('Netflix').fg).toBe('#ffffff')
    expect(brandOf('Some Local Gym').bg).toBe(brandOf('some local gym').bg) // stable for unknowns
    expect(brandOf('Ring Solo Plan').initial).toBe('R')
  })
})

describe('from transactions', () => {
  const series = (payeeName: string, extra: Partial<RecurringSeries> = {}): RecurringSeries => ({
    id: payeeName, payeeId: `p-${payeeName}`, payeeName, categoryId: null, categoryName: null, amount: 1799,
    minAmount: 1799, maxAmount: 1799, amountKind: 'fixed', cadence: 'monthly', intervalDays: 30, occurrences: 4,
    firstDate: '2026-06-12', lastDate: '2026-09-12', nextExpected: '2026-10-12', monthlyCost: 1799,
    yearlyCost: 21588, active: true, confidence: 0.9, isSubscription: true, ...extra,
  })

  it('drafts a monthly subscription with its billing day', () => {
    const d = draftFromSeries(series('NETFLIX.COM'))
    expect(d).toMatchObject({ amount: 1799, cadence: 'monthly', billingDay: 12, status: 'active', amountIsEstimate: false })
  })

  it('drafts a lapsed one straight into cancelled, dated by its last charge', () => {
    const d = draftFromSeries(series('OLD MAGAZINE', { active: false, lastDate: '2026-04-25' }))
    expect(d).toMatchObject({ status: 'cancelled', cancelledOn: '2026-04-25' })
  })

  it('tracks a quarterly charge at its monthly equivalent, as an estimate', () => {
    const d = draftFromSeries(series('INSURER', { cadence: 'quarterly', amount: 30000, monthlyCost: 10000 }))
    expect(d).toMatchObject({ amount: 10000, cadence: 'monthly', amountIsEstimate: true })
  })

  it('recognises one already tracked under a friendlier name', () => {
    expect(isTracked(series('NETFLIX.COM'), [sub('Netflix', 1799, 'monthly')])).toBe(true)
    expect(isTracked(series('SPOTIFY USA'), [sub('Netflix', 1799, 'monthly')])).toBe(false)
  })
})

describe('funding subscriptions from a category', () => {
  it('turns tracked subscriptions into a bundle of bills', async () => {
    const { goalBills } = await import('../subscriptions')
    const base = { amountIsEstimate: false, billedThrough: '', createdAt: '2026-03-02T00:00:00Z', deleted: false, id: 'x' }
    const bills = goalBills([
      { ...base, name: 'Claude', amount: 2299, cadence: 'monthly', billingDay: 30, billingMonth: null, status: 'active' },
      { ...base, name: 'PlayStation Plus', amount: 7999, cadence: 'yearly', billingDay: 14, billingMonth: 10, status: 'active' },
      { ...base, name: 'Mystery yearly', amount: 1200, cadence: 'yearly', billingDay: null, billingMonth: null, status: 'active' },
      { ...base, name: 'Gym', amount: 1000, cadence: 'weekly', billingDay: null, billingMonth: null, status: 'active' },
      { ...base, name: 'YouTube Premium', amount: null, cadence: 'monthly', billingDay: null, billingMonth: null, status: 'active' },
      { ...base, name: 'Disney+', amount: 2159, cadence: 'monthly', billingDay: 27, billingMonth: null, status: 'cancelled' },
    ])
    expect(bills).toEqual([
      { name: 'Claude', amount: 2299, everyMonths: 1 },
      { name: 'Gym', amount: 4333, everyMonths: 1 },
      { name: 'Mystery yearly', amount: 1200, everyMonths: 12, dueMonth: '2027-02' },
      { name: 'PlayStation Plus', amount: 7999, everyMonths: 12, dueMonth: '2026-10' },
    ])
  })
})
